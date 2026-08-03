; 自定义“应用正在运行”检测：
; 安装/升级时若检测到 Codex Bridge 正在运行，弹出中文提示；
; 点击“确定”（或静默安装 /S）自动关闭旧进程后继续，点击“取消”退出安装。
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  ${GetProcessInfo} 0 $pid $1 $2 $3 $4
  ${if} $3 != "${APP_EXECUTABLE_FILENAME}"
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON1 "检测到 Codex Bridge 正在运行。$\r$\n点击“确定”自动关闭并继续安装，点击“取消”退出安装。" /SD IDOK IDOK doStopProcess
      Quit

      doStopProcess:
      DetailPrint `正在关闭正在运行的 "${PRODUCT_NAME}"...`
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
      !else
        nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
      !endif
      Sleep 800
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid"`
      !else
        nsExec::Exec `%SYSTEMROOT%\System32\cmd.exe /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
      !endif
      Sleep 500
    ${endIf}
  ${endIf}
!macroend