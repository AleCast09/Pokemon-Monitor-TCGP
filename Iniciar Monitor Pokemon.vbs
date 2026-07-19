Const vbHidden = 2

Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)

' Al descomprimir el .zip se pierde el atributo "oculto" de estos archivos —
' se lo volvemos a poner cada vez que se abre, así la carpeta queda limpia
' sin importar cómo lo haya extraído la persona.
On Error Resume Next
Set archivoExe = fso.GetFile(carpeta & "\MonitorPokemon.exe")
archivoExe.Attributes = archivoExe.Attributes Or vbHidden

Set archivoBundle = fso.GetFile(carpeta & "\bundle.js")
archivoBundle.Attributes = archivoBundle.Attributes Or vbHidden

Set carpetaAssets = fso.GetFolder(carpeta & "\assets")
carpetaAssets.Attributes = carpetaAssets.Attributes Or vbHidden

Set carpetaModulos = fso.GetFolder(carpeta & "\node_modules")
carpetaModulos.Attributes = carpetaModulos.Attributes Or vbHidden
On Error Goto 0

Set objShell = CreateObject("WScript.Shell")
objShell.Run """" & carpeta & "\MonitorPokemon.exe""", 0, False
