# 3D 에셋 출처와 변환

## 문도와 식칼

- 원본: Riot Games, League of Legends의 Dr. Mundo 기본 모델.
- 제공처: [Khada 모델 뷰어](https://modelviewer.lol/model-viewer?id=36000), [공개 GLB](https://cdn.modelviewer.lol/lol/models/drmundo/36000/model.glb).
- 변환: `mundo/prepare_model.py`를 Blender 4.5에서 실행한다. 기본 몸체와 무기만 남기고 대기·달리기·투척·사망 애니메이션을 추린다. 식칼은 투사체와 1인칭 표시용으로 분리한다.
- 출력: `public/models/mundo.glb`, `public/models/mundo-cleaver.glb`.
- 재현용 원본 위치: `artifacts/blender/drmundo-original.glb`.

## 바론 둥지

- 원본: Riot Games의 과거 소환사의 협곡. 최신 시즌 전체 맵이 아니다.
- 제공처: JDarkGFX가 올린 [SummonersRift Map](https://p3dm.ru/files/others/others/15244-summonersrift-map.html). 해당 페이지의 사용 표시는 Personal use only다.
- 변환: `mundo/prepare_baron.py`에서 OBJ와 DDS를 불러온 뒤 바론 둥지 주변만 잘라낸다. 경기 원 안의 바닥 높이는 서버의 수평 이동 규칙에 맞춘다. 원본 UV와 지형 텍스처를 유지하며 최대 1024px로 내보낸다.
- 출력: `public/models/baron-pit.glb`.
- 재현용 원본 위치: `artifacts/blender/rift/SummonersRift/`의 OBJ, MTL, Textures 폴더.

위 두 원본과 캐릭터·맵의 권리는 Riot Games에 있다. 변환 스크립트가 원본 에셋에 새 라이선스를 부여하지는 않는다. 이 저장소는 수익을 내지 않는 공개 팬 프로젝트다.

SIDEPLAY was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

## 인디언포커

`poker/build_scene.py`로 Blender에서 직접 제작한 인물·라운지다. 외부 캐릭터나 유료 모델을 사용하지 않는다. 출력은 `public/models/poker-person.glb`, `public/models/poker-lounge.glb`다.

Blender 작업 파일과 다운로드 원본은 Git에서 제외하는 `artifacts/blender/`에 보관한다. 변환 스크립트와 게임용 GLB만 저장소에 포함한다.
