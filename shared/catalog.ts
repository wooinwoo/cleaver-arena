export const POKER_VARIANTS = {
  duel: {
    title: '1:1 승부룰',
    max: 2,
    rules: '각자 1~10 개인 덱 10장을 섞어 매 판 한 장씩 뽑아요. 내 숫자는 공개 전까지 숨겨요. 덱을 다 쓰면 다시 섞어요. 각자 20칩으로 시작하고 매 판 기본 1칩, 선공은 교대해요. 콜·원하는 만큼 올리기·포기를 선택해요. 높은 숫자가 모인 칩을 가져가고 동점 칩은 다음 판으로 이월해요. 10을 들고 포기하면 추가 10칩을 상대에게 줘요(남은 칩 한도). 칩은 계속 유지하며 한 명이 모두 잃으면 최종 종료예요. 모두가 낼 수 있는 금액까지만 베팅하며, 전액 베팅 후 동점이면 기본 칩 없이 다시 승부해요. 공개 후 둘 다 다음 판을 누르면 이어집니다. 현금과 무관한 게임 칩이에요.',
  },
  party: {
    title: '기존 파티룰',
    max: 6,
    rules: '2–6인 파티룰: 1~10 중 겹치지 않는 카드 한 장, 각자 20칩, 기본 1칩. 내 카드는 공개 전까지 보이지 않고 상대 이마의 카드만 보여요. 콜·1칩 올리기·포기를 선택해요. 가장 높은 카드가 승리해요. 모두가 낼 수 있는 금액까지만 올릴 수 있어요. 다음 판은 20칩으로 초기화돼요. 동점 이월과 10 포기 벌칙은 없어요. 현금과 무관한 게임 칩이에요.',
  },
} as const;
export type PokerVariant = keyof typeof POKER_VARIANTS;

export const TABLE_GAMES = {
  chess: { title: '체스', min: 2, max: 2, description: '한 수 앞을 보는 정통 체스.', rules: '백이 먼저 시작해요. 캐슬링·앙파상·폰 승격을 지원하며 체크메이트면 승리해요. 스테일메이트·기물 부족·같은 국면 3회·50수 규칙은 자동 무승부로 처리해요. 시간제한은 없어요. 폰 승격은 퀸·룩·비숍·나이트 중 고를 수 있어요.' },
  quoridor: { title: '쿼리도', min: 2, max: 2, description: '상대편 끝줄에 먼저 도착하세요.', rules: '9×9 경기장, 각자 벽 10개. 이동 또는 벽 설치를 선택해요. 상대 말을 뛰어넘을 수 있고, 양쪽의 도착 경로를 완전히 막는 벽은 놓을 수 없어요.' },
  gomoku: { title: '오목', min: 2, max: 2, description: '다섯 개를 먼저 이으면 승리!', rules: '15×15 자유룰이에요. 흑이 먼저 두며 가로·세로·대각선으로 5개 이상 연결하면 이겨요. 삼삼·사사·장목 금수는 적용하지 않아요.' },
  poker: { title: '인디언포커', min: 2, max: 6, description: '상대 이마의 카드를 보고 베팅하는 1인칭 3D 대결. 방에서 1:1 승부룰과 기존 파티룰을 선택해요.', rules: '방을 만들 때 1:1 승부룰 또는 기존 2–6인 파티룰을 선택해요. 친구는 방장이 선택한 룰로 함께 플레이해요.' },
  janggi: { title: '십이장기', min: 2, max: 2, description: '열두 칸 위에서 펼치는 수싸움.', rules: '방을 만들 때 동물장기 또는 더 지니어스 기본룰을 선택해요. 친구는 방장이 선택한 룰로 함께 플레이해요.' },
} as const;
export type TableId = keyof typeof TABLE_GAMES;
export function isTableId(value: unknown): value is TableId {
  return typeof value === 'string' && Object.hasOwn(TABLE_GAMES, value);
}
