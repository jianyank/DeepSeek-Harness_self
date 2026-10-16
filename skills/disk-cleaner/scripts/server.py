#!/usr/bin/env python3
"""Serve the storage report with a guarded one-click delete API (macOS + Windows).

Starts on 127.0.0.1 + a random port + a random per-session token, serves the
interactive report, and exposes POST /action to move green-tier paths to Trash
or delete them outright. Stop with Ctrl+C.

Usage:
    server.py <analysis.json>

SAFETY MODEL — read before changing:
- Allowlist: only paths listed in this report's green/yellow items' trash_paths
  are accepted. Every request path is realpath-resolved and must be in the
  allowlist AND under $HOME. Anything else is rejected.
- Bound to 127.0.0.1 only; every POST requires the session token; Host header
  must be 127.0.0.1 (blocks DNS-rebinding from a malicious page).
- Two modes: "trash" (Finder -> Trash, reversible) and "rm" (immediate,
  irreversible). The browser confirms each action before sending.
- Path validation (from Mole): reject empty, relative, traversal (..), control
  chars, symlinks to system paths, and system-critical paths.
- Audit log: every action is recorded to ~/Library/Logs/disk-cleaner/operations.log
- Fail-closed: if Trash move fails, refuse permanent delete.
"""
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "..", "assets", "report_template.html")
HOME = os.path.realpath(os.path.expanduser("~"))
TOKEN = secrets.token_urlsafe(24)

DATA = {}
TPL = ""
RM_ALLOW = set()
TRASH_ALLOW = set()
OPEN_ALLOW = set()

# Audit log path
AUDIT_LOG_DIR = os.path.join(HOME, "Library", "Logs", "disk-cleaner")
AUDIT_LOG = os.path.join(AUDIT_LOG_DIR, "operations.log")


# ======================================================================
# Path Validation (inspired by Mole's validate_path_for_deletion)
# ======================================================================

# System-critical paths that must never be deleted (macOS + Windows)
CRITICAL_PATHS = {
    "/", "/System", "/bin", "/sbin", "/usr", "/etc", "/var", "/private",
    "/Library/Apple", "/Library/Extensions", "/Library/Keychains",
    "/Applications/Finder.app", "/Applications/Safari.app",
    "/Users", "/Users/Shared", "/Users/Guest",
    # Windows (harmless on macOS, needed for cross-platform)
    "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)",
}

CRITICAL_PREFIXES = (
    "/System/", "/bin/", "/sbin/", "/usr/", "/etc/", "/private/var/",
    "/Library/Apple/", "/Library/Extensions/", "/Library/Keychains/",
    "C:\\Windows\\", "C:\\Program Files\\", "C:\\Program Files (x86)\\",
)

# Paths under protected roots that ARE allowed for cleanup
ALLOWLIST_EXCEPTIONS = (
    "/private/tmp", "/private/var/tmp", "/private/var/log",
    "/private/var/folders",
)


def validate_path(path):
    """Validate a path for deletion. Returns (ok, reason)."""
    if not path:
        return False, "empty path"

    # Must be absolute
    if not os.path.isabs(path):
        return False, "relative path"

    # No path traversal
    parts = os.path.normpath(path).split(os.sep)
    if ".." in parts:
        return False, "path traversal"

    # No control characters
    if any(ord(c) < 32 for c in path):
        return False, "control characters"

    # Normalize
    norm = os.path.normpath(path).rstrip(os.sep)
    if not norm:
        norm = os.sep

    # Symlink check: resolve target and validate it too
    if os.path.islink(path):
        try:
            real = os.path.realpath(path)
            if _is_critical_path(real):
                return False, f"symlink points to critical path: {real}"
        except Exception:
            return False, "cannot read symlink target"

    # Check critical paths
    if _is_critical_path(norm):
        # Check exceptions
        for exc in ALLOWLIST_EXCEPTIONS:
            if norm == exc or norm.startswith(exc + os.sep):
                return True, "ok"
        return False, f"critical system path: {norm}"

    return True, "ok"


def _is_critical_path(norm):
    """Check if normalized path is system-critical."""
    if norm in CRITICAL_PATHS:
        return True
    for prefix in CRITICAL_PREFIXES:
        if norm.startswith(prefix):
            return True
    return False


# ======================================================================
# Audit Logging
# ======================================================================

def audit_log(mode, status, path, detail=""):
    """Append an audit log entry."""
    try:
        os.makedirs(AUDIT_LOG_DIR, exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H:%M:%S")
        line = f"{ts}\t{mode}\t{status}\t{path}\t{detail}\n"
        with open(AUDIT_LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass  # Audit logging is best-effort


# ======================================================================
# Allowlist Loading
# ======================================================================

def expand(p):
    return os.path.realpath(os.path.expanduser(p))


def load(src):
    with open(src, encoding="utf-8") as f:
        data = json.load(f)
    with open(TEMPLATE, encoding="utf-8") as f:
        tpl = f.read()
    # Three allowlists, from strict to lenient:
    #   rm    = only green trash_paths (pure caches safe to hard-delete)
    #   trash = green + yellow trash_paths (yellow only trash, never rm)
    #   open  = trash set + yellow path + red app_paths (non-destructive)
    rm_allow, trash_allow, open_allow = set(), set(), set()
    for it in data.get("green", []):
        for p in (it.get("trash_paths") or []):
            rp = expand(p)
            rm_allow.add(rp); trash_allow.add(rp); open_allow.add(rp)
    for it in data.get("yellow", []):
        for p in (it.get("trash_paths") or []):
            rp = expand(p)
            trash_allow.add(rp); open_allow.add(rp)
        if it.get("path"):
            rp = expand(it["path"])
            if os.path.exists(rp):
                open_allow.add(rp)
    # Red: only allow "open" (app location for user to uninstall)
    for it in data.get("red", []):
        for p in (it.get("app_paths") or []):
            rp = expand(p)
            if os.path.exists(rp):
                open_allow.add(rp)
    return data, tpl, rm_allow, trash_allow, open_allow


# ======================================================================
# Trash / Delete Operations
# ======================================================================

def move_to_trash(path):
    if sys.platform == "darwin":
        _trash_macos(path)
    elif sys.platform.startswith("win"):
        _trash_windows(path)
    else:
        raise OSError("Trash only supported on macOS / Windows")


def _trash_macos(path):
    # osascript Finder delete -> macOS Trash, recoverable.
    script = 'tell application "Finder" to delete (POSIX file %s as alias)' % json.dumps(path)
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if r.returncode != 0:
        # Fallback: move to ~/.Trash
        dest = os.path.join(HOME, ".Trash",
                            os.path.basename(path.rstrip("/")) + "." + time.strftime("%H%M%S"))
        shutil.move(path, dest)


def _trash_windows(path):
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [
            ("hwnd", wintypes.HWND),
            ("wFunc", wintypes.UINT),
            ("pFrom", wintypes.LPCWSTR),
            ("pTo", wintypes.LPCWSTR),
            ("fFlags", ctypes.c_uint16),
            ("fAnyOperationsAborted", wintypes.BOOL),
            ("hNameMappings", ctypes.c_void_p),
            ("lpszProgressTitle", wintypes.LPCWSTR),
        ]

    FO_DELETE = 3
    FOF_ALLOWUNDO = 0x0040
    FOF_NOCONFIRMATION = 0x0010
    FOF_SILENT = 0x0004
    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = os.path.abspath(path) + "\x00\x00"
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT
    rc = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op))
    if rc != 0:
        raise OSError("SHFileOperation failed (code %d)" % rc)


def hard_delete(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.remove(path)


def open_in_file_manager(path):
    target = path if os.path.isdir(path) else os.path.dirname(path)
    if sys.platform == "darwin":
        if target.rstrip("/").endswith(".app"):
            r = subprocess.run(["open", "-R", target], capture_output=True, text=True)
            if r.returncode != 0:
                raise OSError((r.stderr or "open -R failed").strip())
            return
        r = subprocess.run(["open", target], capture_output=True, text=True)
        if r.returncode != 0:
            r2 = subprocess.run(["open", "-R", target], capture_output=True, text=True)
            if r2.returncode != 0:
                raise OSError((r.stderr or r2.stderr or "open failed").strip())
    elif sys.platform.startswith("win"):
        subprocess.run(["explorer", target])
    else:
        raise OSError("Open only supported on macOS / Windows")


# ======================================================================
# HTTP Handler
# ======================================================================

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            blob = json.dumps(DATA, ensure_ascii=False)
            cfg = json.dumps({"token": TOKEN, "endpoint": "/action"})
            html = TPL.replace("__REPORT_DATA__", blob).replace("__DELETE_CONFIG__", cfg)
            self._send(200, html, "text/html; charset=utf-8")
        else:
            self._send(404, "not found", "text/plain")

    def do_POST(self):
        if self.path != "/action":
            self._send(404, json.dumps({"ok": False, "error": "not found"}))
            return
        # DNS-rebinding guard
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            self._send(403, json.dumps({"ok": False, "error": "host not allowed"}))
            return
        n = int(self.headers.get("Content-Length", 0))
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            self._send(400, json.dumps({"ok": False, "error": "invalid request"}))
            return
        if req.get("token") != TOKEN:
            self._send(403, json.dumps({"ok": False, "error": "token mismatch"}))
            return
        mode = req.get("mode")
        allow = {"rm": RM_ALLOW, "trash": TRASH_ALLOW, "open": OPEN_ALLOW}.get(mode)
        if allow is None:
            self._send(400, json.dumps({"ok": False, "error": "unknown mode"}))
            return
        done = []
        for p in (req.get("paths") or []):
            rp = expand(p)
            # Allowlist check
            if rp not in allow:
                audit_log(mode, "rejected", rp, "not in allowlist")
                self._send(403, json.dumps({"ok": False, "error": "path not allowed: %s" % p}))
                return
            # HOME boundary check (or /Applications for open mode)
            valid_roots = (HOME, "/Applications")
            if not any(rp == base or rp.startswith(base + os.sep) for base in valid_roots):
                audit_log(mode, "rejected", rp, "outside home")
                self._send(403, json.dumps({"ok": False, "error": "path outside home: %s" % p}))
                return
            # Path validation (Mole-style)
            ok, reason = validate_path(p)
            if not ok:
                audit_log(mode, "rejected", rp, reason)
                self._send(403, json.dumps({"ok": False, "error": "path unsafe: %s (%s)" % (p, reason)}))
                return
            try:
                if mode == "open":
                    open_in_file_manager(rp)
                    audit_log("open", "ok", rp)
                elif not os.path.exists(rp):
                    pass  # already gone
                elif mode == "trash":
                    move_to_trash(rp)
                    audit_log("trash", "ok", rp)
                else:
                    hard_delete(rp)
                    audit_log("rm", "ok", rp)
                done.append(p)
            except Exception as e:
                audit_log(mode, "error", rp, str(e))
                self._send(500, json.dumps({"ok": False, "error": str(e)}))
                return
        self._send(200, json.dumps({"ok": True, "done": done}))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    global DATA, TPL, RM_ALLOW, TRASH_ALLOW, OPEN_ALLOW
    DATA, TPL, RM_ALLOW, TRASH_ALLOW, OPEN_ALLOW = load(sys.argv[1])
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = srv.server_address[1]
    url = "http://127.0.0.1:%d/" % port
    print("disk-cleaner 报告服务已启动：" + url)
    print("绿灯可删 %d 项 | 橙灯可移废纸篓/打开 %d 项 | 安全模型: Mole + khazix" %
          (len(RM_ALLOW), len(TRASH_ALLOW) - len(RM_ALLOW)))
    print("用完按 Ctrl+C 停止服务")
    webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止服务。")


if __name__ == "__main__":
    main()
