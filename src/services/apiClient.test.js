import {
  callApiWithRetry,
  isRetryableApiError,
} from './apiClient';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    })),
  },
}));

afterEach(() => {
  jest.restoreAllMocks();
});

test('classifies terminal and transient HTTP failures', () => {
  expect(isRetryableApiError({ response: { status: 409 } })).toBe(false);
  expect(isRetryableApiError({ response: { status: 429 } })).toBe(true);
  expect(isRetryableApiError({ response: { status: 503 } })).toBe(true);
  expect(isRetryableApiError(new Error('network failure'))).toBe(true);
});

test('returns a 409 conflict after one API attempt', async () => {
  const conflict = new Error('coin has dependencies');
  conflict.response = { status: 409 };
  const apiCall = jest.fn().mockRejectedValue(conflict);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  await expect(callApiWithRetry(apiCall, 3, 1)).rejects.toBe(conflict);
  expect(apiCall).toHaveBeenCalledTimes(1);
});
