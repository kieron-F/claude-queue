Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & Replace(WScript.ScriptFullName, "start-hidden.vbs", "src\tray.js") & """", 0, False
