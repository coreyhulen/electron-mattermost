# The $env:PATH is way too long. This prevents new strings to be added to the
# PATH env variable. We will remove all the stuff added for programs in
# Program Files (64 bits and 32 bits variants) except Git.
# src.: https://gist.github.com/wget/a102f89c301014836aaa49a98dd06ee2
Write-Host "Old PATH: $env:Path"
Write-Host "Reducing PATH..."
[array]$newPath=($env:Path -split ';') | Where-Object { $_ -notlike "C:\Program Files*"}
$newPath += ($env:Path -split ';') | Where-Object { $_ -like "C:\Program Files*\*Git*"}
$env:Path = $newPath -join ';'
[Environment]::SetEnvironmentVariable("Path", $env:Path, [System.EnvironmentVariableTarget]::Machine)
[Environment]::SetEnvironmentVariable("INCLUDE", $env:INCLUDE, [System.EnvironmentVariableTarget]::User)
Write-Host "New PATH: $env:Path"

Write-Host "Updating choco packages..."
choco upgrade all --yes

Write-Host "Installing nodejs-lts..."
choco install nodejs-lts --yes

# npm is always installed as a nodejs dependency. 64 bits version available.
# C:\Program Files\nodejs\node_modules\npm\bin
$progFile = ${env:ProgramFiles}
$npmDir = Join-Path -Path "$progFile" -ChildPath "nodejs"
$env:Path += ";$npmDir"

Write-Host "Installing wixtoolset..."
choco install wixtoolset --yes
# Wixtoolset is always installed as a 32 bits based program.
# Note: We are using the coalesce syntax of Powershell here.
$progFile = (${env:ProgramFiles(x86)}, ${env:ProgramFiles} -ne $null)[0]
$wixDirs = @(Get-ChildItem -Path $progFile -Recurse -Filter "*wix toolset*" -Attributes Directory -Depth 2)
$wixDir = Join-Path -Path "$progFile" -ChildPath "$($wixDirs[0])"
$wixDir = Join-Path -Path "$wixDir" -ChildPath "bin"
$env:Path += ";$wixDir"

# Add signtool to path
$signToolDir = Join-Path -Path "$progFile" -ChildPath "Windows Kits\10\bin\x64"
$env:Path += ";$signToolDir"

Write-Host "Getting build date..."
$env:MATTERMOST_BUILD_DATE = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")

Write-Host "Getting build version..."
# Wix and npm do require to have semver parsable versions. They do not like to
# have versions like v4.3.0-rc0. We are thus forcing to have a format like
# 4.3.0.rc0.
$env:MATTERMOST_BUILD_ID = [string]$(git describe --abbrev=0)
$env:MATTERMOST_BUILD_ID_SEMVER = [string]$(git describe --abbrev=0) -Replace '-','.'
# Remove non number and . chars
$env:MATTERMOST_BUILD_ID_SEMVER = $env:MATTERMOST_BUILD_ID_SEMVER -Replace '[^0-9.]'
# Only take major.minor.build if any
$env:MATTERMOST_BUILD_ID_SEMVER = $env:MATTERMOST_BUILD_ID_SEMVER.Split('.')[0..2] -Join '.'
# If we are not building a tag, add the date
if ($env:APPVEYOR_REPO_TAG -ne $true) {
    $env:MATTERMOST_BUILD_ID += "-" + (Get-Date).ToUniversalTime().ToString("yyyyMMddhhmmss")
    $env:MATTERMOST_BUILD_ID_SEMVER += (Get-Date).ToUniversalTime().ToString("yyyyMMddhhmmss")
}

Write-Host "Patching version from msi xml descriptor..."
$msiDescriptorFileName = Join-Path -Path "$(Get-Location)" -ChildPath "scripts\msi_installer.wxs"
$msiDescriptor = [xml](Get-Content $msiDescriptorFileName)
$msiDescriptor.Wix.Product.Version = [string]$env:MATTERMOST_BUILD_ID_SEMVER
$msiDescriptor.Save($msiDescriptorFileName)

Write-Host "Patching version from electron package.json..."
$packageFileName = Join-Path -Path "$(Get-Location)" -ChildPath "package.json"
$package = Get-Content $packageFileName -Raw | ConvertFrom-Json
$package.version = [string]$env:MATTERMOST_BUILD_ID_SEMVER
$package | ConvertTo-Json | Set-Content $packageFileName
Write-Host "Patching version from electron src\package.json..."
$packageFileName = Join-Path -Path "$(Get-Location)" -ChildPath "src\package.json"
$package = Get-Content $packageFileName -Raw | ConvertFrom-Json
$package.version = [string]$env:MATTERMOST_BUILD_ID_SEMVER
$package | ConvertTo-Json | Set-Content $packageFileName

Write-Host "Getting list of commits for changelog..."
$previousTag = $(Invoke-Expression "git describe --abbrev=0 --tags $(git describe --abbrev=0)^")
if ($env:APPVEYOR_REPO_TAG -eq $true) {
    $currentTag = [string]$(git describe --abbrev=0)
} else {
    $currentTag = [string]"HEAD"
}
$changelogRaw = $(git log --oneline --since="$(git log -1 "$previousTag" --pretty=%ad)" --until="$(git log -1 "$currentTag" --pretty=%ad)")
$changelog = "";
foreach ($i in $changelogRaw) {
    $changelog += "* $i`n"
}
$env:MATTERMOST_BUILD_CHANGELOG = $changelog

Write-Host "Working directory:"
Get-Location
Write-Host "Installing dependencies (running npm install)..."
npm install
Write-Host "Building JS code (running npm run build)..."
npm run build
Write-Host "Packaging for Windows (running npm run package:windows)..."
npm run package:windows

# Only sign the executable and .dll if this is a release and not a pull request
# check.
if ($env:APPVEYOR_REPO_TAG -eq $true) {
    Write-Host "Enforcing signature of the executable and dll..."

    # Decrypt the certificate. The decrypted version will be at
    # .\resources\windows\certificate\mattermost-desktop-windows.pfx
    iex ((New-Object Net.WebClient).DownloadString('https://raw.githubusercontent.com/appveyor/secure-file/master/install.ps1'))
    # Secure variables are never decoded during Pull Request
    # except if the repo is private and a secure org has been created
    # src.: https://www.appveyor.com/docs/build-configuration/#secure-variables
    appveyor-tools\secure-file -decrypt .\resources\windows\certificate\mattermost-desktop-windows.pfx.enc -secret "$env:certificate_decryption_key_encrypted"

    foreach ($archPath in "release\win-unpacked", "release\win-ia32-unpacked") {

        # Note: The C++ redistribuable files will be resigned again even if they have a
        # correct signature from Microsoft. Windows doesn't seem to complain, but we
        # don't know whether this is authorized by the Microsoft EULA.
        Get-ChildItem -path $archPath -recurse *.dll | ForEach-Object {
            Write-Host "Signing $($_.FullName) (waiting for 2 * 15 seconds)..."
            # Waiting for at least 15 seconds is needed because these time
            # servers usually have rate limits and signtool can fail with the
            # following error message:
            # "SignTool Error: The specified timestamp server either could not be reached or returned an invalid response.
            # src.: https://web.archive.org/web/20190306223053/https://github.com/electron-userland/electron-builder/issues/2795#issuecomment-466831315
            Start-Sleep -s 15
            signtool.exe sign /f .\resources\windows\certificate\mattermost-desktop-windows.pfx /p $env:certificate_private_key_encrypted /tr http://timestamp.digicert.com /fd sha1 /td sha1 $_.FullName
            Start-Sleep -s 15
            signtool.exe sign /f .\resources\windows\certificate\mattermost-desktop-windows.pfx /p $env:certificate_private_key_encrypted /tr http://timestamp.digicert.com /fd sha256 /td sha256 /as $_.FullName
        }

        Write-Host "Signing $archPath\Mattermost.exe (waiting for 2 * 15 seconds)..."
        Start-Sleep -s 15
        signtool.exe sign /f .\resources\windows\certificate\mattermost-desktop-windows.pfx /p $env:certificate_private_key_encrypted /tr http://timestamp.digicert.com /fd sha1 /td sha1 $archPath\Mattermost.exe
        Start-Sleep -s 15
        signtool.exe sign /f .\resources\windows\certificate\mattermost-desktop-windows.pfx /p $env:certificate_private_key_encrypted /tr http://timestamp.digicert.com /fd sha256 /td sha256 /as $archPath\Mattermost.exe
    }
}

Write-Host "Cleaning build dir..."
Remove-Item .\release\win-ia32-unpacked\resources\app.asar.unpacked\ -Force -Recurse
Remove-Item .\release\win-unpacked\resources\app.asar.unpacked\ -Force -Recurse

heat dir .\release\win-ia32-unpacked\ -o .\scripts\msi_installer_files.wxs -scom -frag -srd -sreg -gg -cg MattermostDesktopFiles -t .\scripts\msi_installer_files_replace_id.xslt -dr INSTALLDIR
candle.exe -dPlatform=x86 .\scripts\msi_installer.wxs .\scripts\msi_installer_files.wxs -o .\scripts\
light.exe .\scripts\msi_installer.wixobj .\scripts\msi_installer_files.wixobj -loc .\resources\windows\msi_i18n\en_US.wxl -o .\release\mattermost-desktop-$($env:MATTERMOST_BUILD_ID)-x86.msi -b ./release/win-ia32-unpacked/

heat dir .\release\win-unpacked\ -o .\scripts\msi_installer_files.wxs -scom -frag -srd -sreg -gg -cg MattermostDesktopFiles -t .\scripts\msi_installer_files_replace_id.xslt -t .\scripts\msi_installer_files_set_win64.xslt -dr INSTALLDIR
candle.exe -dPlatform=x64 .\scripts\msi_installer.wxs .\scripts\msi_installer_files.wxs -o .\scripts\
light.exe .\scripts\msi_installer.wixobj .\scripts\msi_installer_files.wixobj -loc .\resources\windows\msi_i18n\en_US.wxl -o .\release\mattermost-desktop-$($env:MATTERMOST_BUILD_ID)-x64.msi -b ./release/win-unpacked/


# Only sign the executable and .dll if this is a release and not a pull request
# check.
if ($env:APPVEYOR_REPO_TAG -eq $true) {
    Write-Host "Signing .\release\mattermost-desktop-$($env:MATTERMOST_BUILD_ID)-x86.msi (waiting for 15 seconds)..."
    Start-Sleep -s 15
    # Dual signing is not supported on msi files. Is it recommended to sign with 256 hash.
    # src.: https://security.stackexchange.com/a/124685/84134
    # src.: https://social.msdn.microsoft.com/Forums/windowsdesktop/en-us/d4b70ecd-a883-4289-8047-cc9cde28b492#0b3e3b80-6b3b-463f-ac1e-1bf0dc831952
    signtool.exe sign /f .\resources\windows\certificate\mattermost-desktop-windows.pfx /p $env:certificate_private_key_encrypted /tr http://timestamp.digicert.com /fd sha256 /td sha256 .\release\mattermost-desktop-$($env:MATTERMOST_BUILD_ID)-x86.msi

    Write-Host "Signing .\release\mattermost-desktop-$($env:MATTERMOST_BUILD_ID)-x64.msi (waiting for 2 * 15 seconds)..."
    Start-Sleep -s 15
    signtool.exe sign /f .\resources\windows\certificate\mattermost-desktop-windows.pfx /p $env:certificate_private_key_encrypted /tr http://timestamp.digicert.com /fd sha256 /td sha256 .\release\mattermost-desktop-$($env:MATTERMOST_BUILD_ID)-x64.msi
}
