const { createHash } = require('node:crypto');
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');

const runner = process.argv[2];
const original = 'setTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid);';
const expectedHash = '0bb3a34508785bdc34626542f9358d398fd9f60fdaf4b48201dfdff2122f25fc';

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!/\/dsh-sandbox-windows-acl\/lib\/types-[^/]+\.js$/.test(url)) return result;
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    if (createHash('sha256').update(source).digest('hex') !== expectedHash || source.split(original).length !== 2) {
      throw new Error('Unsupported Windows ACL backend; review the shell fix before upgrading');
    }
    // Preserve capability grants and allow login-session process initialization.
    const addition = '\n\t\t\tif (this.mode === "workspace-write") setTokenDefaultDaclGrant(api, restrictedToken, logonSid);';
    return { ...result, source: source.replace(original, original + addition) };
  }
});

process.argv = [process.execPath, runner, ...process.argv.slice(3)];
import(pathToFileURL(runner).href).catch(error => {
  process.stderr.write(`windows-acl-run: ${error.message}\n`);
  process.exitCode = 127;
});
