// claude-preload.js — world: "MAIN", document_start 실행
// Claude의 iframe 감지 우회:
//   1. window.top / parent → 현재 window 반환 (JS 레벨 iframe 감지 차단)
//   2. window.frameElement → null 반환
//   3. location.ancestorOrigins → 빈 리스트 반환 (추가 감지 차단)
// 주의: 서버 사이드 Sec-Fetch-Dest: iframe 감지는 Forbidden Header라 우회 불가.
//       React #418은 서버/클라이언트 HTML 불일치로 발생하는 RecoverableError이며,
//       React가 자동으로 클라이언트 렌더링으로 폴백하므로 동작에는 영향 없음.

(function () {
  try {
    const w = window;

    // 1. window.top, window.parent → window 자신으로 스푸핑
    ['top', 'parent'].forEach(function (p) {
      try {
        Object.defineProperty(w, p, {
          get: function () { return w; },
          configurable: true
        });
      } catch (e) {}
    });

    // 2. window.frameElement → null
    try {
      Object.defineProperty(w, 'frameElement', {
        get: function () { return null; },
        configurable: true
      });
    } catch (e) {}

    // 3. location.ancestorOrigins → 빈 DOMStringList 반환
    //    Claude가 ancestorOrigins.length > 0 으로 iframe을 감지하는 경우 차단
    try {
      Object.defineProperty(Location.prototype, 'ancestorOrigins', {
        get: function () {
          const empty = Object.create(DOMStringList.prototype);
          Object.defineProperty(empty, 'length', { value: 0, writable: false, configurable: true });
          empty.item = function () { return null; };
          empty.contains = function () { return false; };
          empty[Symbol.iterator] = function* () {};
          return empty;
        },
        configurable: true
      });
    } catch (e) {}

  } catch (e) {}
})();
