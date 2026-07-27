import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DecimalNumberInput from '../DecimalNumberInput';

function ControlledInput({ onCommit }) {
  const [value, setValue] = useState(1);
  return (
    <DecimalNumberInput
      ariaLabel="数量"
      value={value}
      onCommit={(nextValue) => {
        setValue(nextValue);
        onCommit(nextValue);
      }}
    />
  );
}

test('preserves decimal editing states and commits the completed value', () => {
  const onCommit = jest.fn();
  render(<ControlledInput onCommit={onCommit} />);
  const input = screen.getByLabelText('数量');

  fireEvent.change(input, { target: { value: '' } });
  expect(input).toHaveValue('');
  expect(onCommit).toHaveBeenCalledTimes(0);

  fireEvent.change(input, { target: { value: '0.' } });
  expect(input).toHaveValue('0.');
  expect(onCommit).toHaveBeenCalledTimes(0);

  fireEvent.change(input, { target: { value: '0.5' } });
  expect(input).toHaveValue('0.5');
  expect(onCommit).toHaveBeenLastCalledWith(0.5);
});

test('restores the last committed value when editing ends on an invalid value', () => {
  const onCommit = jest.fn();
  render(<ControlledInput onCommit={onCommit} />);
  const input = screen.getByLabelText('数量');

  fireEvent.change(input, { target: { value: '-' } });
  fireEvent.blur(input);

  expect(input).toHaveValue('1');
  expect(onCommit).toHaveBeenCalledTimes(0);
});
