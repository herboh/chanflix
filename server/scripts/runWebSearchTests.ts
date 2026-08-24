import {
  isSafePublicWebUrl,
  normalizeSearxngResults,
  searchWeb,
} from "@server/lib/webSearch";
import assert from "assert";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "web search accepts ordinary public links and rejects unsafe targets",
    run: () => {
      assert.equal(
        isSafePublicWebUrl("https://www.imdb.com/title/tt0111161/"),
        true
      );
      assert.equal(isSafePublicWebUrl("ftp://example.com/file"), false);
      assert.equal(isSafePublicWebUrl("https://user@example.com/"), false);
      assert.equal(isSafePublicWebUrl("http://localhost/admin"), false);
      assert.equal(isSafePublicWebUrl("http://127.0.0.1/admin"), false);
      assert.equal(isSafePublicWebUrl("http://2130706433/admin"), false);
      assert.equal(isSafePublicWebUrl("http://10.2.3.4/"), false);
      assert.equal(isSafePublicWebUrl("http://[::1]/"), false);
      assert.equal(isSafePublicWebUrl("http://[::127.0.0.1]/"), false);
      assert.equal(isSafePublicWebUrl("http://[fc00::1]/"), false);
      assert.equal(isSafePublicWebUrl("https://router.home.arpa/"), false);
      assert.equal(isSafePublicWebUrl("https://example.com:8443/"), false);
    },
  },
  {
    name: "web search normalizes, sanitizes, deduplicates, and bounds results",
    run: () => {
      assert.deepEqual(
        normalizeSearxngResults(
          {
            results: [
              {
                title: "<b>Dune</b> review",
                url: "https://example.com/dune#review",
                content: "A\n <em>measured</em> review.\u0000",
                publishedDate: "2024-03-01T12:00:00Z",
              },
              {
                title: "Duplicate",
                url: "https://example.com/dune",
                content: "Duplicate result.",
              },
              {
                title: "Internal result",
                url: "http://192.168.1.10/movie",
              },
              {
                title: "Second result",
                url: "https://www.rogerebert.com/reviews/dune-2021",
                content: "Criticism.",
              },
            ],
          },
          2
        ),
        [
          {
            title: "Dune review",
            url: "https://example.com/dune",
            domain: "example.com",
            snippet: "A measured review.",
            date: "2024-03-01T12:00:00.000Z",
          },
          {
            title: "Second result",
            url: "https://www.rogerebert.com/reviews/dune-2021",
            domain: "rogerebert.com",
            snippet: "Criticism.",
          },
        ]
      );
      assert.equal(normalizeSearxngResults({ nope: [] }), undefined);
      assert.equal(
        normalizeSearxngResults(
          {
            results: Array.from({ length: 6 }, (_, index) => ({
              title: `Result ${index}`,
              url: `https://example.com/${index}`,
            })),
          },
          99
        )?.length,
        4
      );
    },
  },
  {
    name: "web search sends one bounded GET to the configured SearXNG origin",
    run: async () => {
      let requestCount = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        requestCount += 1;
        const url = new URL(input.toString());
        assert.equal(url.origin, "https://search.example.com");
        assert.equal(url.pathname, "/searx/search");
        assert.equal(url.searchParams.get("q"), "Dune Part Two reviews");
        assert.equal(url.searchParams.get("format"), "json");
        assert.equal(url.searchParams.get("categories"), "general");
        assert.equal(url.searchParams.get("safesearch"), "1");
        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "error");

        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Dune: Part Two review",
                url: "https://example.org/reviews/dune-part-two",
                content: "A useful result.",
              },
            ],
          }),
          { headers: { "content-type": "application/json; charset=utf-8" } }
        );
      };

      assert.deepEqual(
        await searchWeb("  Dune\nPart Two reviews  ", {
          baseUrl: "https://search.example.com/searx/",
          fetchImpl,
        }),
        {
          ok: true,
          query: "Dune Part Two reviews",
          results: [
            {
              title: "Dune: Part Two review",
              url: "https://example.org/reviews/dune-part-two",
              domain: "example.org",
              snippet: "A useful result.",
            },
          ],
          untrusted: true,
        }
      );
      assert.equal(requestCount, 1);
    },
  },
  {
    name: "web search rejects invalid queries without making a request",
    run: async () => {
      let requested = false;
      const fetchImpl: typeof fetch = async () => {
        requested = true;
        throw new Error("must not run");
      };
      const result = await searchWeb("", { fetchImpl });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "invalid_query");
      assert.equal(requested, false);
    },
  },
  {
    name: "web search rejects oversized response bodies while streaming",
    run: async () => {
      const fetchImpl: typeof fetch = async () =>
        new Response("x".repeat(1_025), {
          headers: { "content-type": "application/json" },
        });
      const result = await searchWeb("movie news", {
        fetchImpl,
        maxResponseBytes: 1_024,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "invalid_response");
    },
  },
  {
    name: "web search turns its deadline into a stable timeout result",
    run: async () => {
      const fetchImpl: typeof fetch = async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        });
      const result = await searchWeb("current movie news", {
        fetchImpl,
        timeoutMs: 10,
      });
      assert.deepEqual(result, {
        ok: false,
        code: "timeout",
        message: "Web search timed out. Try a narrower query.",
        retryable: true,
      });
    },
  },
  {
    name: "web search marks rate limits as retryable without reading the body",
    run: async () => {
      const fetchImpl: typeof fetch = async () =>
        new Response("slow down", { status: 429 });
      const result = await searchWeb("movie news", { fetchImpl });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "unavailable");
        assert.equal(result.retryable, true);
      }
    },
  },
];

const run = async () => {
  let failures = 0;
  for (const test of tests) {
    try {
      await test.run();
      process.stdout.write(`PASS ${test.name}\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`FAIL ${test.name}\n`);
      process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    }
  }
  if (failures) process.exitCode = 1;
};

void run();
