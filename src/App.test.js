import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    BrowserRouter: ({ children }) => <div>{children}</div>,
    Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
    Navigate: () => null,
    Route: ({ path, element }) => (path === '/login' ? element : null),
    Routes: ({ children }) => <>{children}</>,
    useLocation: () => ({ pathname: '/login' }),
    useNavigate: () => jest.fn(),
  };
}, { virtual: true });

jest.mock('./services/api', () => {
  const fallback = jest.fn(() => Promise.resolve({}));
  return new Proxy({
    __esModule: true,
    verifyToken: jest.fn(() => Promise.reject(new Error('missing token'))),
    getRegistrationStatus: jest.fn(() => Promise.resolve({ registrationEnabled: true })),
  }, {
    get(target, prop) {
      return prop in target ? target[prop] : fallback;
    },
  });
});

const App = require('./App').default;

test('renders login page for unauthenticated users', async () => {
  localStorage.clear();
  render(<App />);
  await waitFor(() => expect(screen.getByText(/登录/i)).toBeInTheDocument());
});
