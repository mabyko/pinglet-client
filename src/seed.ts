import { FeedMessage } from "./types";

/**
 * 서버 없이도 동작하기 위한 시드 메시지.
 * 서버 feed를 받아오면 대체되며, 서버 장애 시 fallback으로 사용된다.
 */
export const SEED_MESSAGES: FeedMessage[] = [
  { id: "seed_001", text: "오늘도 merge conflict 없는 하루 보내세요.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_002", text: "금요일 오후 배포는 다음 생에 합시다.", author: "익명의 백엔드 개발자", contentType: "USER" },
  { id: "seed_003", text: "console.log 디버깅은 부끄러운 게 아닙니다.", author: "익명의 프론트엔드 개발자", contentType: "USER" },
  { id: "seed_004", text: "테스트가 한 번에 통과하면, 테스트를 의심하세요.", author: "익명의 QA", contentType: "USER" },
  { id: "seed_005", text: "커밋 메시지가 'fix' 3연속이면 잠시 산책을 다녀오세요.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_006", text: "오늘의 버그는 내일의 나에게 맡깁시다.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_007", text: "rm -rf 치기 전에 pwd 한 번 더.", author: "익명의 인프라 개발자", contentType: "USER" },
  { id: "seed_008", text: "리팩터링은 내일부터. 오늘은 일단 돌아가게.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_009", text: "빌드 도는 동안 물 한 잔 드세요. 수분은 소중하니까.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_010", text: "당신의 코드는 생각보다 괜찮습니다. 진짜로요.", author: "익명의 시니어 개발자", contentType: "USER" },
  { id: "seed_011", text: "LGTM 받았다면 리뷰어에게 감사 인사 잊지 마세요.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_012", text: "월요일 아침 CI가 빨간불이어도 당신 잘못이 아닙니다.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_013", text: "완벽한 설계보다 오늘 배포되는 코드가 낫습니다.", author: "익명의 창업자", contentType: "USER" },
  { id: "seed_014", text: "야근하지 마세요. 버그는 아침에 더 잘 보입니다.", author: "익명의 개발자", contentType: "USER" },
  { id: "seed_015", text: "Pinglet에 오신 걸 환영합니다. AI가 생각하는 동안 만나요.", author: "Pinglet 팀", contentType: "SYSTEM" },
];
