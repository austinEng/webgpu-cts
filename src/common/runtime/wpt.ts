// Implements the wpt-embedded test runner (see also: wpt/cts.html).

import { DefaultTestFileLoader } from '../framework/file_loader.js';
import { Logger } from '../framework/logging/logger.js';
import { parseQuery } from '../framework/query/parseQuery.js';
import { TestQueryWithExpectation } from '../framework/query/query.js';
import { assert } from '../framework/util/util.js';

import { optionEnabled } from './helper/options.js';
import { TestWorker } from './helper/test_worker.js';

// testharness.js API (https://web-platform-tests.org/writing-tests/testharness-api.html)
declare interface WptTestObject {
  step(f: () => void): void;
  done(): void;
}
declare function setup(properties: { explicit_done?: boolean }): void;
declare function promise_test(f: (t: WptTestObject) => Promise<void>, name: string): void;
declare function done(): void;

setup({
  // It's convenient for us to asynchronously add tests to the page. Prevent done() from being
  // called implicitly when the page is finished loading.
  explicit_done: true,
});

declare let __WEBGPU_TEST_HARNESS_EXPECTATIONS_PATH__: string | undefined;

(async () => {
  const expectationList: TestQueryWithExpectation[] = [];
  if (typeof __WEBGPU_TEST_HARNESS_EXPECTATIONS_PATH__ !== 'undefined') {
    await import(__WEBGPU_TEST_HARNESS_EXPECTATIONS_PATH__).then(({ expectations }) => {
      for (const [query, expectation] of Object.entries(expectations)) {
        assert(expectation === 'skip' || expectation === 'fail');
        expectationList.push({
          query: parseQuery(query),
          expectation,
        });
      }
    });
  }

  const loader = new DefaultTestFileLoader();
  const qs = new URLSearchParams(window.location.search).getAll('q');
  assert(qs.length === 1, 'currently, there must be exactly one ?q=');
  const testcases = await loader.loadCases(parseQuery(qs[0]), expectationList);

  const worker = optionEnabled('worker') ? new TestWorker(false) : undefined;

  const log = new Logger(false);

  for (const testcase of testcases) {
    const name = testcase.query.toString();
    const wpt_fn = async (t: WptTestObject) => {
      const [rec, res] = log.record(name);
      if (worker) {
        await worker.run(rec, name);
      } else {
        await testcase.run(rec);
      }

      t.step(() => {
        // Unfortunately, it seems not possible to surface any logs for warn/skip.
        if (res.status === 'fail') {
          throw (res.logs || []).map(s => s.toJSON()).join('\n\n');
        }
      });
    };

    promise_test(wpt_fn, name);
  }

  done();
})();
