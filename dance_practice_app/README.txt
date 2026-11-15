크리스마스 댄스 연습실 (데스크톱 프로그램) - 소스 코드
=====================================================

Electron(JavaScript)으로 만든 윈도우용 프로그램입니다.
유튜브 영상 재생은 Electron에 들어 있는 브라우저 부품을 사용합니다.

[폴더 구성]
- main.js        : 프로그램 창을 만들고, 내부 전용 작은 웹서버(127.0.0.1)를 켜는 코드
                   (유튜브가 파일로 연 페이지에서는 재생을 막기 때문에 필요합니다)
- app/index.html : 연습실 화면과 기능 전체 (재생, 거울모드, 배속, 음량, 구간 반복, 북마크, 자막)
- package.json   : 프로그램 정보와 실행/빌드 명령
- .gitignore     : 빌드 결과물(node_modules, dist)을 저장소에서 제외

[직접 실행하기 - 개발용]
1. Node.js(LTS 버전)를 설치합니다.  https://nodejs.org
2. 이 폴더에서 명령 프롬프트(또는 VS Code 터미널)를 열고:
      npm install
      npm start

[윈도우용 프로그램(.exe) 다시 만들기]
      npm install
      npm run package:win
   -> dist\ChristmasDancePractice-win32-x64\ChristmasDancePractice.exe 가 만들어집니다.
   -> 이 폴더(ChristmasDancePractice-win32-x64)를 통째로 복사하면 다른 컴퓨터에서도 실행됩니다.

[수정하는 곳]
- 화면, 버튼, 기본 구간(00:02 오프닝 훅 등), 기본 유튜브 주소: app/index.html
  (DEFAULT_URL, DEFAULT_SECTIONS 를 찾으면 됩니다)
- 창 크기, 제목: main.js 의 new BrowserWindow({...})

[알아두기]
- 구간, 메모, 음량 등 기록은 이 컴퓨터의 프로그램 데이터 폴더에 저장됩니다.
  (%APPDATA%\ChristmasDancePractice)
- 유튜브 영상은 인터넷 연결이 필요합니다. 인터넷이 없으면 MP4 파일로 연습하세요.
- 사용 버전: Electron 33.2.1, @electron/packager 18.3.6
