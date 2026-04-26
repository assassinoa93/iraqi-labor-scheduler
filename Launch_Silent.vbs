Set WshShell = CreateObject("WScript.Shell")
' Run the launch.bat script hidden (0 = hidden, True = wait for completion)
WshShell.Run "cmd.exe /c launch.bat", 0, False
