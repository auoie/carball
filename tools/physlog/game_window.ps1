# Read-only look at Rocket League's window: state, and optionally a screenshot of its contents (PrintWindow, which
# neither activates nor moves the window).  powershell -File game_window.ps1 [OUT.png]
param([string]$Out = "")
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsHungAppWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool GetClientRect(System.IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool PrintWindow(System.IntPtr h, System.IntPtr hdc, uint flags);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
$p = Get-Process RocketLeague -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { "running=False"; exit 1 }
$h = $p.MainWindowHandle
"running=True minimized=$([W.U]::IsIconic($h)) hung=$([W.U]::IsHungAppWindow($h)) responding=$($p.Responding) title='$($p.MainWindowTitle)'"
if ($Out -ne "" -and -not [W.U]::IsIconic($h)) {
    $r = New-Object W.U+RECT
    [void][W.U]::GetClientRect($h, [ref]$r)
    $bmp = New-Object System.Drawing.Bitmap ([Math]::Max(1, $r.Right)), ([Math]::Max(1, $r.Bottom))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = [W.U]::PrintWindow($h, $hdc, 3)   # PW_CLIENTONLY | PW_RENDERFULLCONTENT (DirectX content)
    $g.ReleaseHdc($hdc)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    "screenshot=$Out ok=$ok size=$($r.Right)x$($r.Bottom)"
}
