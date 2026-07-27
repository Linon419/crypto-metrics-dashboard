import React, { useEffect, useRef, useState } from 'react';

function toText(value) {
  if (value === null || value === undefined) return '';
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : '';
}

/**
 * 小数输入框（期权倍率 / 腿位数量）。
 *
 * 受控的 <input type="number"> 在 "1." "0." 这类中间态会把 value 上报成空串，
 * 直接 Number(value) 会把数量悄悄改成别的值：输 0.5 变成 15、退格重输 2 变成 12。
 * 这里编辑期间只保存原始字符串，解析成合法正数才向上提交，失焦时再回滚非法输入。
 */
function DecimalNumberInput({
  ariaLabel,
  className,
  onCommit,
  placeholder,
  value,
}) {
  const [text, setText] = useState(() => toText(value));
  const lastValueRef = useRef(value);

  // 只有外部值真的变了才覆盖输入框，正在敲的中间态不能被冲掉
  useEffect(() => {
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;
    setText(current => (Number(current) === Number(value) ? current : toText(value)));
  }, [value]);

  const commit = (nextText) => {
    const parsed = Number(nextText);
    if (String(nextText).trim() === '' || !Number.isFinite(parsed) || parsed <= 0) return false;
    lastValueRef.current = parsed;
    onCommit(parsed);
    return true;
  };

  return (
    <input
      aria-label={ariaLabel}
      className={className}
      inputMode="decimal"
      placeholder={placeholder}
      type="text"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        commit(event.target.value);
      }}
      onBlur={() => {
        if (!commit(text)) setText(toText(value));
      }}
    />
  );
}

export default DecimalNumberInput;
