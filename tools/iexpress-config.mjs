import path from 'node:path'

export function iexpressConfig(stage, output) {
  const lines = ['[Version]', 'Class=IEXPRESS', 'SEDVersion=3', '[Options]', 'PackagePurpose=InstallApp', 'ShowInstallProgramWindow=1', 'HideExtractAnimation=0', 'UseLongFileName=1', 'InsideCompressed=0', 'CAB_FixedSize=0', 'CAB_ResvCodeSigning=0', 'RebootMode=N', 'TargetName=' + output, 'FriendlyName=DSH Self 1.0.0', 'AppLaunched=cmd.exe /c bootstrap.cmd', 'PostInstallCmd=<None>', 'AdminQuietInstCmd=cmd.exe /c bootstrap.cmd', 'UserQuietInstCmd=cmd.exe /c bootstrap.cmd', 'SourceFiles=SourceFiles', '[SourceFiles]', 'SourceFiles0=' + stage + path.sep, '[SourceFiles0]', '%FILE0%=', '%FILE1%=', '[Strings]', 'FILE0="bootstrap.cmd"', 'FILE1="payload.zip"']
  return lines.join('\r\n')
}
