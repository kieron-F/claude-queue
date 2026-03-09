Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & Replace(WScript.ScriptFullName, "start-hidden.vbs", "src\tray.js") & """ --no-open", 0, False
