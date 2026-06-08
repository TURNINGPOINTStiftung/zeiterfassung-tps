$ErrorActionPreference = 'SilentlyContinue'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8765/')
$listener.Start()
# Serviert das Projektverzeichnis (Ordner dieser Datei) lokal über HTTP, damit
# der ES-Modul-Syntaxcheck (_syntaxcheck.html) und Render-Tests laufen können.
# ES-Module lassen sich in Chrome NICHT über file:// laden (CORS) – daher HTTP.
$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$sw = [System.Diagnostics.Stopwatch]::StartNew()
while ($listener.IsListening -and $sw.Elapsed.TotalSeconds -lt 30) {
  $task = $listener.GetContextAsync()
  while (-not $task.IsCompleted -and $sw.Elapsed.TotalSeconds -lt 30) { Start-Sleep -Milliseconds 40 }
  if (-not $task.IsCompleted) { break }
  $ctx = $task.Result
  $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.LocalPath).TrimStart('/')
  if ($path -eq '') { $path = 'index.html' }
  $file = Join-Path $root $path
  if (Test-Path $file -PathType Leaf) {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ext = [System.IO.Path]::GetExtension($file).ToLower()
    switch ($ext) {
      '.js'   { $ctx.Response.ContentType = 'text/javascript' }
      '.html' { $ctx.Response.ContentType = 'text/html' }
      '.css'  { $ctx.Response.ContentType = 'text/css' }
      '.json' { $ctx.Response.ContentType = 'application/json' }
      default { $ctx.Response.ContentType = 'application/octet-stream' }
    }
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else {
    $ctx.Response.StatusCode = 404
  }
  $ctx.Response.Close()
}
$listener.Stop()
