; 설치 프로그램 추가 동작 (electron-builder NSIS)
; 프로그램을 지울 때 "윈도우 시작 시 자동 실행" 등록도 함께 지움.
; (업데이트로 다시 설치하는 경우에는 지우지 않음)
; 등록 이름 = main.js 의 APP_ID
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.calendarwidget.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "app.calendarwidget.desktop"
  ${endIf}
!macroend
