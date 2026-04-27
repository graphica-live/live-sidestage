#ifndef SourceRoot
  #define SourceRoot "..\\..\\dist\\windows\\app"
#endif

#ifndef OutputDir
  #define OutputDir "..\\..\\dist\\windows\\installer"
#endif

[Setup]
AppId={{B9FA1A0D-AB31-4B63-B24B-7D0A01A0DDA8}
AppName=TikEffect
AppVersion=1.0.0
AppPublisher=Local Install
DefaultDirName={autopf}\TikEffect
DefaultGroupName=TikEffect
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=TikEffect-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile={#SourceRoot}\TikEffect.ico
UninstallDisplayIcon={app}\TikEffect.ico

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
#include "generated-launchers-icons.iss"

[Run]
#include "generated-launchers-run.iss"