; アンインストール時に Windows スタートアップから TikEffectLoader を削除する
!macro customUnInit
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "TikEffectLoader"
!macroend
