# Christmas Dance Practice - tiny local web server (Windows PowerShell 5.1+, nothing to install)
# Serves the files in this folder at http://localhost:PORT/ so YouTube videos can play.
# Listens on 127.0.0.1 only, so other computers cannot connect.

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path)).TrimEnd('\') + '\'
$page = 'dance_practice.html'

if (-not (Test-Path -LiteralPath (Join-Path $root $page))) {
  Write-Host "Cannot find $page next to this script. Keep all files in the same folder."
  Read-Host 'Press Enter to close'
  exit 1
}

$listener = $null
$port = 0
foreach ($p in 8765..8775) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch { }
}

if ($null -eq $listener) {
  Write-Host 'Could not start the local web server (ports 8765-8775 are all busy).'
  Write-Host 'Opening the page directly instead. YouTube may not play; use "MP4 file" in the page.'
  Start-Process (Join-Path $root $page)
  Read-Host 'Press Enter to close'
  exit 1
}

$url = "http://localhost:$port/$page"
Write-Host ''
Write-Host '  ==============================================='
Write-Host '   Christmas Dance Practice is running'
Write-Host "   $url"
Write-Host '   Keep this window open while practicing.'
Write-Host '   Close this window to stop.'
Write-Host '  ==============================================='
Write-Host ''
Start-Process $url

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.vtt'  = 'text/vtt; charset=utf-8'
  '.srt'  = 'text/plain; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 3000
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
    $line = $reader.ReadLine()
    while ($true) {
      $h = $reader.ReadLine()
      if ($null -eq $h -or $h -eq '') { break }
    }

    $method = ''
    $path = '/'
    if ($line -and $line -match '^(GET|HEAD) (\S+) HTTP/') {
      $method = $Matches[1]
      $path = $Matches[2]
    }

    $status = '200 OK'
    $ctype = 'text/plain; charset=utf-8'
    $body = $null

    if ($method -eq '') {
      $status = '400 Bad Request'
      $body = [System.Text.Encoding]::UTF8.GetBytes('Bad request')
    } else {
      $path = [System.Uri]::UnescapeDataString(($path -split '\?')[0])
      if ($path -eq '/') { $path = '/' + $page }
      $rel = $path.TrimStart('/').Replace('/', '\')
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $body = [System.IO.File]::ReadAllBytes($full)
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        if ($types.ContainsKey($ext)) { $ctype = $types[$ext] } else { $ctype = 'application/octet-stream' }
      } else {
        $status = '404 Not Found'
        $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      }
    }

    $head = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
  } catch {
    # ignore broken or idle connections (browsers sometimes open spare ones)
  } finally {
    $client.Close()
  }
}
