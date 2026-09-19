// What a stubbed fetch was called with, typed. vi.fn() with no signature reports its calls as an empty
// tuple, so reading call[0] or call[1].body is an error even though every call in these tests passes a URL
// string and an init object. Narrowed in one place instead of casting at each assertion.

export type FetchCall = [url: string, init: RequestInit];

export const fetchCalls = (mock: { mock: { calls: unknown[] } }): FetchCall[] => mock.mock.calls as FetchCall[];
