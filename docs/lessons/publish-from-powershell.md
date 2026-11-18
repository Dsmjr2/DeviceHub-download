# Publish from PowerShell, with its own module path

Run helpers/publish-release.ps1 from PowerShell, never Git Bash (Git's tar cannot read `C:` paths). From a PowerShell 7 session, first set PSModulePath to Windows PowerShell's own folders, or Get-FileHash is missing in the nested powershell.exe.

**What happened:** 1.58's first build stopped under Git Bash; 1.65's first publish stopped in make-installer after the code was already pushed (rerunning fixed it).

**Source:**
- JOURNAL.md, 4 Nov 2026 (1.58) and 13 Nov 2026 (1.65)
- CLAUDE.md, Publishing and the signing key
