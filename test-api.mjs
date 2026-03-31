/**
 * FitStreak API E2E Test Script
 * 실제 API 동작을 단계별로 검증합니다.
 */

const BASE = 'http://localhost:3000';
let token = '';
let userId = '';
let friendToken = '';
let friendId = '';
let logId = '';

async function req(method, path, body, authToken) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

function log(title, result) {
  const ok = result.status < 400;
  console.log(`\n${ ok ? '✅' : '❌' } ${title} [${result.status}]`);
  console.log(JSON.stringify(result.data, null, 2));
  if (!ok) process.exit(1);
}

// ─────────────────────────────────────────────────────────────
console.log('\n🏋️  FitStreak API E2E Test\n' + '='.repeat(50));

// 1. 회원가입
let r = await req('POST', '/auth/register', {
  email: 'demo@fitstreak.dev',
  displayName: '데모유저',
  password: 'password123',
  timezone: 'Asia/Seoul',
});
// 이미 가입된 경우 로그인으로 fallback
if (r.status === 409) {
  r = await req('POST', '/auth/login', {
    email: 'demo@fitstreak.dev',
    password: 'password123',
  });
  log('로그인 (기존 계정)', r);
} else {
  log('회원가입', r);
}
token  = r.data.token;
userId = r.data.user.id;

// 2. 친구 계정 생성
let r2 = await req('POST', '/auth/register', {
  email: 'friend@fitstreak.dev',
  displayName: '친구유저',
  password: 'password123',
  timezone: 'Asia/Seoul',
});
if (r2.status === 409) {
  r2 = await req('POST', '/auth/login', { email: 'friend@fitstreak.dev', password: 'password123' });
}
friendToken = r2.data.token;
friendId    = r2.data.user.id;
console.log(`\n👥 친구 계정: ${r2.data.user.displayName} (${friendId})`);

// 3. 오늘 운동 기록
r = await req('POST', '/workouts', {
  note: '오늘 벤치프레스 5세트 완료! 💪',
  gpsVerified: true,
}, token);
log('오늘 운동 기록', r);
logId = r.data?.logId; // 있으면 저장

// 4. 같은 날 중복 기록 시도
r = await req('POST', '/workouts', {
  note: '중복 기록 시도',
}, token);
log('중복 기록 → alreadyLogged=true 확인', r);
console.assert(r.data.alreadyLogged === true, 'alreadyLogged should be true');

// 5. Streak 조회
r = await req('GET', '/workouts/streak', null, token);
log('Streak 조회', r);
console.assert(r.data.streak.currentStreak >= 1, 'currentStreak >= 1');

// 6. 운동 기록 목록
r = await req('GET', '/workouts?page=1&limit=5', null, token);
log('운동 기록 목록', r);
if (r.data.logs?.length > 0) logId = r.data.logs[0].id;

// 7. 팔로우
r = await req('POST', `/users/${friendId}/follow`, null, token);
log(`친구 팔로우`, r);

// 8. 친구 운동 기록
await req('POST', '/workouts', {
  note: '친구의 운동 기록 🏃',
  visibility: 'friends',
}, friendToken);

// 9. 피드 조회
r = await req('GET', '/workouts/feed', null, token);
log('친구 피드 조회', r);

// 10. 반응(리액션)
if (logId) {
  r = await req('POST', `/workouts/${logId}/reactions`, { type: 'fire' }, friendToken);
  log('리액션 추가 (fire)', r);

  r = await req('DELETE', `/workouts/${logId}/reactions`, null, friendToken);
  log('리액션 제거', r);
}

// 11. 프로필 조회
r = await req('GET', `/users/${userId}/profile`, null, token);
log('프로필 조회', r);

// 12. 언팔로우
r = await req('DELETE', `/users/${friendId}/follow`, null, token);
log('언팔로우', r);

console.log('\n' + '='.repeat(50));
console.log('🎉 모든 E2E 테스트 통과!\n');
