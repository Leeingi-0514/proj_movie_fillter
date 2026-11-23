2026-11-17에 `/Users/lee/Downloads/subfilter 2`를 현재 MovieGuard 프로젝트와 비교해 검증했습니다. **기본 자막 → JSON 변환은 동작하지만, 현재 상태를 MovieGuard와 완전히 호환된다고 판단할 수는 없습니다.** 재현된 오류는 3종이며, 특히 `type` 값 불일치는 결과 파일 전체의 로딩을 막습니다.

제공된 README는 프로그램이 주장하는 동작을 확인하는 자료로 사용했습니다. 원본 프로그램과 MovieGuard 소스는 수정하지 않았으며, 검증 전후 원본 파일의 SHA-256이 모두 같았습니다.

검증은 제공 샘플 4개(SRT/VTT/ASS/CP949 SMI)와 직접 만든 SRT 11개로 수행했습니다. 빈 파일과 잘못된 파일도 포함합니다. 51개 확인 항목 중 **46개 통과, 4개 실패, 1개 동작상 주의사항**이 나왔습니다. 실패 4개 중 2개는 같은 호환성 오류를 웹과 확장 프로그램에서 각각 확인한 것입니다. 이 수치는 AI 분류 정확도를 뜻하지 않습니다.

| 검증 내용 | 관찰 결과 |
| --- | --- |
| 기본 SRT 변환 | `title`, `segments`, `id/start/end/type/reason/summary`를 갖는 JSON 생성 |
| 제공 `sample.srt` | 공포 43–50초, 선정성 151–156초, 폭력성 248–256초 출력 |
| 분리된 합성 장면 | 8–14초, 38–45초, 78–85초로 여유 시간과 초 단위 내림/올림 확인 |
| 일반 대화만 있는 SRT | 정상 종료하고 `segments: []` 출력 |
| UTF-8 BOM, UTF-16, CP949 SRT | 한글과 시간 구간 정상 보존 |
| 205개 자막의 SRT | 기본 100개 단위 청크 경계를 지나도 대상 구간 보존 및 병합 |
| 제목·분류·신뢰도 옵션 | 지정한 제목과 선택 조건 적용 |
| 서로 떨어진 장면의 심각도 옵션 | 지정한 최소 심각도 적용 |
| 로컬 웹 업로드·작업 조회·다운로드 | 실제 HTTP 요청으로 정상 흐름 확인 |
| 빈 파일·깨진 SRT·없는 파일·잘못된 옵션 | 오류 반환 확인 |
| 캐시 재사용·일부 청크 실패 후 재시도 | 결정적 가짜 분석기로 정상 처리 확인 |
| 실제 MovieGuard 로더 | `both`만 있는 출력은 웹과 확장 프로그램 모두 수용 |

**가장 먼저 수정해야 할 부분은 필터 종류의 변환입니다.**

`subfilter`의 [exporter.py](</Users/lee/Downloads/subfilter 2/subfilter/exporter.py:96>)는 분석 결과의 `media`를 그대로 출력의 `type`에 넣습니다. 이 값은 `audio`, `video`, `both`입니다. 현재 MovieGuard [웹 로더](</Users/lee/Documents/ChatGPT/movie_guard 2/filter-engine.js:1>)와 [확장 프로그램 로더](</Users/lee/Documents/ChatGPT/movie_guard 2/extension/filter-engine.js:5>)는 `blur`, `mute`, `both`, `skip`을 받습니다.

분석기가 `audio`, `video`, `both`를 반환하는 상황을 결정적 검증 데이터로 만들고 실제 후처리·출력기를 실행했습니다. 생성된 [media_modes.json](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/media_modes.json>)은 두 로더 모두에서 거부됐습니다. [로더의 실제 오류 메시지](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/media_modes.loader-results.json>)도 저장했습니다.

출력 시 `audio → mute`, `video → blur`, `both → both`로 변환해야 합니다. `--mock`은 항상 `both`만 반환하므로, 기본 샘플에서 성공하는 것만으로 이 오류를 발견할 수 없습니다.

**겹친 자막에서는 판정한 장면의 뒷부분이 빠질 수 있습니다.**

[overlap_range.srt](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/fixtures/overlap_range.srt>)의 첫 자막은 10–30초, 두 번째 자막은 15–16초입니다. 두 자막을 하나의 장면으로 판정한 상황을 넣으면 전체 구간은 10–30초를 덮어야 하지만, 실제 출력은 [10–16초](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/overlap_range.json>)입니다. 이 검증에서는 문제를 분리해 보기 위해 앞뒤 여유 시간을 0으로 지정했습니다.

[postprocess.py](</Users/lee/Downloads/subfilter 2/subfilter/postprocess.py:21>)가 범위 안 모든 자막의 최대 종료 시각 대신, 마지막 번호 자막의 종료 시각을 쓰기 때문입니다. 범위 내 종료 시각의 최댓값을 사용해야 합니다.

**웹에서 모든 분류를 해제하면 전체 장면이 다운로드됩니다.**

화면은 “고른 분류가 없어 빈 결과가 내려받아집니다.”라고 안내하지만, 실제 다운로드 요청 `cats=&minsev=1`은 합성 샘플의 장면 3개를 모두 반환했습니다. [실제 다운로드 결과](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/web-no-categories.json>)를 저장했습니다.

[web.py](</Users/lee/Downloads/subfilter 2/subfilter/web.py:142>)의 `parse_qs()`가 기본 설정에서 빈 값을 버리므로, `cats`가 없는 요청으로 처리되고 전체 분류가 기본 선택됩니다. `parse_qs(url.query, keep_blank_values=True)`처럼 빈 선택을 유지해야 합니다.

**심각도 필터는 병합된 장면을 기준으로 적용된다는 점도 알아야 합니다.**

같은 분류에서 심각도 1 장면이 10–12초, 심각도 3 장면이 14–16초에 있으면 먼저 병합되어 심각도 3의 10–16초 구간이 됩니다. 이후 “심각도 3만”으로 내려받아도 [10–16초 전체가 포함](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/adjacent_severity_3.json>)됩니다. 장면의 최고 심각도를 대표값으로 삼는 설계라면 의도된 동작일 수 있어, 확정 오류와 구분했습니다. 약한 개별 구간을 정확히 제외하려는 요구라면 필터링을 병합 전에 적용하거나 원래 판정들을 보존해야 합니다.

이번 실행 환경의 기본 Python은 3.9.6이며 `charset-normalizer`는 설치되어 있습니다. **`ANTHROPIC_API_KEY`가 설정되어 있지 않고 `anthropic` SDK도 없어, 실제 Claude 호출 및 실제 영화의 공포·선정성·폭력성 판정 정확도는 검증하지 못했습니다.** 검증 스크립트는 외부 API를 호출하지 않습니다.

일반 샘플은 키워드 기반 `--mock`으로 검사했습니다. 가림 방식·겹친 자막·실패 복구는 지정한 판정을 반환하는 가짜 분석기를 사용했습니다. API 응답 처리도 가짜 클라이언트로 JSON 해석과 두 번의 분석 흐름만 검사했습니다. 모델 ID의 유효성, SDK/API 호환성, 실제 장면 요약의 정확성 및 자막에 없는 시청각 장면의 탐지는 별도 확인이 필요합니다. 브라우저 클릭·영상 재생의 육안 검증은 이번 JSON 변환 검증에 포함하지 않았습니다.

검증 자료는 이 보고서와 같은 폴더에 있습니다.

- [results.json](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/results.json>): 51개 항목별 예상값·실제값·검증 방식
- [verify.py](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/verify.py>): 재실행 가능한 검증 스크립트
- [verify_loaders.mjs](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/verify_loaders.mjs>): 실제 MovieGuard 웹·확장 프로그램 로더 실행
- [기본 SRT의 출력 JSON](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/shipped_srt.json>), [합성 SRT](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/fixtures/mixed_scenes.srt>), [합성 SRT의 출력 JSON](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/outputs/mixed_scenes.json>)
- [source-sha256.json](</Users/lee/Documents/ChatGPT/movie_guard 2/artifacts/subfilter-validation-2026-11-17/source-sha256.json>): 원본 파일 해시

MovieGuard 프로젝트 루트에서 아래처럼 재실행할 수 있습니다. 로컬 HTTP 테스트를 위해 임시 `127.0.0.1` 포트를 엽니다. 확인된 오류가 남아 있어 검증 스크립트의 종료 코드는 1입니다.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 artifacts/subfilter-validation-2026-11-17/verify.py
```
