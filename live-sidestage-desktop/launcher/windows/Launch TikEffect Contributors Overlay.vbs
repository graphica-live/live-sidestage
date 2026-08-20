Option Explicit

Dim shell
Dim fileSystem
Dim scriptDirectory
Dim launcherScript
Dim powershellPath
Dim appDataDirectory
Dim command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
launcherScript = fileSystem.BuildPath(scriptDirectory, "Launch TikEffect.ps1")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
appDataDirectory = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\TikEffect")

command = Quote(powershellPath) _
    & " -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Quote(launcherScript) _
    & " -AppHome " & Quote(scriptDirectory) _
    & " -AppDataDir " & Quote(appDataDirectory) _
    & " -AutoOpenBrowser 1 -AppStartPath /overlays/contributors"

shell.Run command, 0, False

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
