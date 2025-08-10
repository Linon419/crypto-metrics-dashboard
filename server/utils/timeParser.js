// server/utils/timeParser.js
// 时间解析工具函数，支持多种时间精度格式

/**
 * 解析灵活的时间输入格式
 * @param {string} dateInput - 输入的时间字符串
 * @param {Date} fallbackDate - 当无法解析时使用的备用日期
 * @returns {Object} 包含解析结果的对象
 */
function parseFlexibleDateTime(dateInput, fallbackDate = new Date()) {
  if (!dateInput || typeof dateInput !== 'string') {
    return {
      date: formatToISO(fallbackDate, 'day'),
      timestamp: fallbackDate,
      precision: 'day',
      isValid: false,
      source: 'fallback'
    };
  }

  const trimmedInput = dateInput.trim();

  // 格式1: "2024.5.9" 或 "24.5.9" (年.月.日)
  const yearMonthDayMatch = trimmedInput.match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})$/);
  if (yearMonthDayMatch) {
    let year = parseInt(yearMonthDayMatch[1], 10);
    const month = parseInt(yearMonthDayMatch[2], 10);
    const day = parseInt(yearMonthDayMatch[3], 10);

    // 处理两位年份：24 -> 2024
    if (year < 100) {
      year += 2000;
    }

    // 验证年月日的有效性
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const timestamp = new Date(year, month - 1, day);
      // 验证日期是否有效
      if (timestamp.getFullYear() === year && timestamp.getMonth() === month - 1 && timestamp.getDate() === day) {
        return {
          date: formatToISO(timestamp, 'day'),
          originalInput: trimmedInput,
          timestamp: timestamp,
          precision: 'day',
          isValid: true,
          source: 'parsed'
        };
      }
    }
  }

  // 格式2: "5.9" (月.日) - 使用智能年份推断
  const dayFormatMatch = trimmedInput.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dayFormatMatch) {
    const month = parseInt(dayFormatMatch[1], 10);
    const day = parseInt(dayFormatMatch[2], 10);
    const year = inferYear(month, fallbackDate);

    // 验证月份和日期的有效性
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const timestamp = new Date(year, month - 1, day);
      // 验证日期是否有效（例如2月30日是无效的）
      if (timestamp.getMonth() === month - 1 && timestamp.getDate() === day) {
        return {
          date: formatToISO(timestamp, 'day'),
          originalInput: trimmedInput,
          timestamp: timestamp,
          precision: 'day',
          isValid: true,
          source: 'parsed'
        };
      }
    }
  }
  
  // 格式3: "2024.5.9 14:30" 或 "24.5.9 14:30" (年.月.日 时:分)
  const yearMonthDayHourMinuteMatch = trimmedInput.match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (yearMonthDayHourMinuteMatch) {
    let year = parseInt(yearMonthDayHourMinuteMatch[1], 10);
    const month = parseInt(yearMonthDayHourMinuteMatch[2], 10);
    const day = parseInt(yearMonthDayHourMinuteMatch[3], 10);
    const hour = parseInt(yearMonthDayHourMinuteMatch[4], 10);
    const minute = parseInt(yearMonthDayHourMinuteMatch[5], 10);

    // 处理两位年份
    if (year < 100) {
      year += 2000;
    }

    // 验证时间的有效性
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
        hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const timestamp = new Date(year, month - 1, day, hour, minute);
      // 验证日期是否有效
      if (timestamp.getFullYear() === year && timestamp.getMonth() === month - 1 && timestamp.getDate() === day) {
        return {
          date: formatToISO(timestamp, 'minute'),
          originalInput: trimmedInput,
          timestamp: timestamp,
          precision: 'minute',
          isValid: true,
          source: 'parsed'
        };
      }
    }
  }

  // 格式4: "2024.5.9 14" 或 "24.5.9 14" (年.月.日 时)
  const yearMonthDayHourMatch = trimmedInput.match(/^(\d{2,4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2})$/);
  if (yearMonthDayHourMatch) {
    let year = parseInt(yearMonthDayHourMatch[1], 10);
    const month = parseInt(yearMonthDayHourMatch[2], 10);
    const day = parseInt(yearMonthDayHourMatch[3], 10);
    const hour = parseInt(yearMonthDayHourMatch[4], 10);

    // 处理两位年份
    if (year < 100) {
      year += 2000;
    }

    // 验证时间的有效性
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
        hour >= 0 && hour <= 23) {
      const timestamp = new Date(year, month - 1, day, hour, 0);
      // 验证日期是否有效
      if (timestamp.getFullYear() === year && timestamp.getMonth() === month - 1 && timestamp.getDate() === day) {
        return {
          date: formatToISO(timestamp, 'hour'),
          originalInput: trimmedInput,
          timestamp: timestamp,
          precision: 'hour',
          isValid: true,
          source: 'parsed'
        };
      }
    }
  }

  // 格式5: "5.9 14:30" (月.日 时:分) - 使用智能年份推断
  const hourMinuteFormatMatch = trimmedInput.match(/^(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (hourMinuteFormatMatch) {
    const month = parseInt(hourMinuteFormatMatch[1], 10);
    const day = parseInt(hourMinuteFormatMatch[2], 10);
    const hour = parseInt(hourMinuteFormatMatch[3], 10);
    const minute = parseInt(hourMinuteFormatMatch[4], 10);
    const year = inferYear(month, fallbackDate);

    // 验证时间的有效性
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
        hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const timestamp = new Date(year, month - 1, day, hour, minute);
      // 验证日期是否有效（例如2月30日是无效的）
      if (timestamp.getMonth() === month - 1 && timestamp.getDate() === day) {
        return {
          date: formatToISO(timestamp, 'minute'),
          originalInput: trimmedInput,
          timestamp: timestamp,
          precision: 'minute',
          isValid: true,
          source: 'parsed'
        };
      }
    }
  }
  
  // 格式6: "5.9 14" (月.日 时) - 使用智能年份推断
  const hourFormatMatch = trimmedInput.match(/^(\d{1,2})\.(\d{1,2})\s+(\d{1,2})$/);
  if (hourFormatMatch) {
    const month = parseInt(hourFormatMatch[1], 10);
    const day = parseInt(hourFormatMatch[2], 10);
    const hour = parseInt(hourFormatMatch[3], 10);
    const year = inferYear(month, fallbackDate);

    // 验证时间的有效性
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour >= 0 && hour <= 23) {
      const timestamp = new Date(year, month - 1, day, hour, 0);
      // 验证日期是否有效（例如2月30日是无效的）
      if (timestamp.getMonth() === month - 1 && timestamp.getDate() === day) {
        return {
          date: formatToISO(timestamp, 'hour'),
          originalInput: trimmedInput,
          timestamp: timestamp,
          precision: 'hour',
          isValid: true,
          source: 'parsed'
        };
      }
    }
  }
  
  // 格式4: 标准ISO格式 "2024-05-09" 或 "2024-05-09T14:30:00"
  try {
    const isoDate = new Date(trimmedInput);
    if (!isNaN(isoDate.getTime())) {
      let precision = 'day';
      if (trimmedInput.includes('T') || trimmedInput.includes(' ')) {
        if (trimmedInput.includes(':')) {
          precision = trimmedInput.split(':').length >= 2 ? 'minute' : 'hour';
        } else {
          precision = 'hour';
        }
      }
      
      return {
        date: formatToISO(isoDate, precision),
        originalInput: trimmedInput,
        timestamp: isoDate,
        precision: precision,
        isValid: true,
        source: 'iso'
      };
    }
  } catch (error) {
    // ISO解析失败，继续尝试其他格式
  }
  
  // 如果所有格式都无法解析，返回备用日期
  return {
    date: formatToISO(fallbackDate, 'day'),
    timestamp: fallbackDate,
    precision: 'day',
    isValid: false,
    source: 'fallback',
    originalInput: trimmedInput
  };
}

/**
 * 将日期格式化为存储格式
 * @param {Date} date - 要格式化的日期
 * @param {string} precision - 时间精度
 * @returns {string} 格式化后的日期字符串
 */
function formatDateForStorage(date, precision = 'day') {
  if (!date || isNaN(date.getTime())) {
    return new Date().toISOString().split('T')[0];
  }
  
  const month = date.getMonth() + 1;
  const day = date.getDate();
  
  switch (precision) {
    case 'minute':
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${month}.${day} ${hours}:${minutes}`;
    case 'hour':
      const hour = date.getHours();
      return `${month}.${day} ${hour}`;
    case 'day':
    default:
      return `${month}.${day}`;
  }
}

/**
 * 将时间精度转换为显示格式
 * @param {string} dateStr - 日期字符串
 * @param {string} precision - 时间精度
 * @returns {string} 显示格式的时间字符串
 */
function formatDateForDisplay(dateStr, precision = 'day') {
  if (!dateStr) return '';
  
  // 如果已经是显示格式，直接返回
  if (typeof dateStr === 'string' && dateStr.includes('.')) {
    return dateStr;
  }
  
  // 如果是Date对象或ISO字符串，转换为显示格式
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return formatDateForStorage(date, precision);
    }
  } catch (error) {
    console.warn('无法格式化日期:', dateStr, error);
  }
  
  return dateStr;
}

/**
 * 将日期格式化为ISO格式
 * @param {Date} date - 要格式化的日期
 * @param {string} precision - 时间精度
 * @returns {string} ISO格式的日期字符串
 */
function formatToISO(date, precision = 'day') {
  if (!date || isNaN(date.getTime())) {
    return new Date().toISOString().split('T')[0];
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (precision) {
    case 'minute':
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    case 'hour':
      const hour = String(date.getHours()).padStart(2, '0');
      return `${year}-${month}-${day} ${hour}:00`;
    case 'day':
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * 智能推断年份
 * @param {number} month - 月份 (1-12)
 * @param {Date} referenceDate - 参考日期
 * @returns {number} 推断的年份
 */
function inferYear(month, referenceDate = new Date()) {
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth() + 1; // JavaScript月份从0开始

  // 如果输入的月份比当前月份大很多（比如当前是1月，输入12月），
  // 可能是指去年的数据
  if (month > currentMonth + 6) {
    return currentYear - 1;
  }

  // 如果输入的月份比当前月份小很多（比如当前是12月，输入1月），
  // 可能是指明年的数据
  if (month < currentMonth - 6) {
    return currentYear + 1;
  }

  // 其他情况使用当前年份
  return currentYear;
}

/**
 * 验证时间精度值
 * @param {string} precision - 时间精度
 * @returns {string} 有效的时间精度值
 */
function validateTimePrecision(precision) {
  const validPrecisions = ['day', 'hour', 'minute'];
  return validPrecisions.includes(precision) ? precision : 'day';
}

module.exports = {
  parseFlexibleDateTime,
  formatDateForStorage,
  formatDateForDisplay,
  formatToISO,
  validateTimePrecision,
  inferYear
};
