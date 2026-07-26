import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Register from '../Register';
import { getRegistrationStatus } from '../../services/api';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();

jest.mock('react-redux', () => ({
  useDispatch: () => mockDispatch,
  useSelector: selector => selector({
    auth: { loading: false, error: null, isAuthenticated: false },
  }),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}), { virtual: true });

jest.mock('../../services/api', () => ({
  register: jest.fn(),
  getRegistrationStatus: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('keeps registration closed when the public setting response is malformed', async () => {
  getRegistrationStatus.mockResolvedValue({});

  render(<Register />);

  expect(await screen.findByText('暂时无法确认注册状态')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '注册' })).not.toBeInTheDocument();
});
