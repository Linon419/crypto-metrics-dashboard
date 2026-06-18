import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { useAutoHideOnScroll } from './useAutoHideOnScroll';

function ScrollProbe({ enabled = true }) {
  const hidden = useAutoHideOnScroll(enabled, { hideAfter: 50, minDelta: 5 });
  return <div data-testid="scroll-state">{hidden ? 'hidden' : 'visible'}</div>;
}

const setScrollY = (value) => {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    writable: true,
    value,
  });
};

describe('useAutoHideOnScroll', () => {
  let requestAnimationFrameSpy;

  beforeEach(() => {
    setScrollY(0);
    requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
  });

  it('hides on downward scroll and shows on upward scroll', () => {
    render(<ScrollProbe />);

    expect(screen.getByTestId('scroll-state')).toHaveTextContent('visible');

    act(() => {
      setScrollY(80);
      window.dispatchEvent(new Event('scroll'));
    });

    expect(screen.getByTestId('scroll-state')).toHaveTextContent('hidden');

    act(() => {
      setScrollY(60);
      window.dispatchEvent(new Event('scroll'));
    });

    expect(screen.getByTestId('scroll-state')).toHaveTextContent('visible');
  });

  it('stays visible when disabled', () => {
    render(<ScrollProbe enabled={false} />);

    act(() => {
      setScrollY(80);
      window.dispatchEvent(new Event('scroll'));
    });

    expect(screen.getByTestId('scroll-state')).toHaveTextContent('visible');
  });
});
