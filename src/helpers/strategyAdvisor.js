// helpers/strategyAdvisor.js (如果创建此文件)
// 或者直接将这些函数定义在 Dashboard.jsx 文件顶部

// 核心：爱好风险者可以在爆破指数跌到200以下开始做空，进场期第一天止盈
// 核心：风险在于爆破指数可能在进场期内再次上攻破200
// 核心：风险厌恶者可以在退场期第一天开始做空，爆破指数从负变正数止盈
// 核心：风险在于退场期内可能会经历多次再次破0
// 核心：场外1000是资本拉盘的效率指标，低于这个数字拉盘资金是阻力大于动力的
// 核心：每次爆破转正和进场开始都是抄底和加仓的好时机

/**
 * 判断是否为“进场/加仓”机会
 * @param {object} coin - 币种对象，需要包含 explosionIndex, entryExitType, entryExitDay, otcIndex
 * @returns {boolean}
 */
export const isEntryCandidate = (coin) => {
    if (!coin) return false;
    const { explosionIndex, entryExitType, entryExitDay, otcIndex } = coin;
  
    // 规则1: 进场期开始 (第1天)
    if (entryExitType === 'entry' && entryExitDay === 1) {
      return true;
    }
    // 规则2: 爆破指数转正 (假设之前是负或低，现在大于等于某个阈值，比如0或一个小的正数)
    // 这个需要前一天数据对比，如果 coin 对象有 previousDayExplosionIndex
    if (coin.previousDayExplosionIndex !== undefined && coin.previousDayExplosionIndex < 0 && explosionIndex >= 0) {
       return true;
    }
    // 规则3: 进场期，且场外指数低于1000 (适合波段)
    if (entryExitType === 'entry' && otcIndex < 1000) {
      return true;
    }
    // 规则4: 进场期，场外指数超过1000 (最后加仓时机)
    if (entryExitType === 'entry' && otcIndex >= 1000) {
      return true; // 也可以用不同的策略名标记
    }
    return false;
  };
  
  /**
   * 判断是否为“止盈/做空”机会
   * @param {object} coin - 币种对象
   * @returns {boolean}
   */
  export const isExitShortCandidate = (coin) => {
    if (!coin) return false;
    const { explosionIndex, entryExitType, entryExitDay, otcIndex } = coin;
  
    // 规则1: 风险厌恶者 - 退场期第1天开始做空
    if (entryExitType === 'exit' && entryExitDay === 1) {
      return true;
    }
    // 规则2: 爱好风险者 - 爆破指数跌到200以下开始做空
    // (增加条件：如果不是明确的进场初期，避免与进场信号冲突)
    if (explosionIndex < 200 && !(entryExitType === 'entry' && entryExitDay <= 3)) { // 小于200就可以考虑
      return true;
    }
    
    // 规则3: 止盈（做多） - 进场期，otcIndex >=1000，非首日 (思考盈利退出)
    if (entryExitType === 'entry' && entryExitDay > 1 && otcIndex >= 1000) {
      return true; // 标记为止盈信号
    }
  
    // 规则4: 止盈（做空 - 风险厌恶者）：退场期内，爆破指数从负变正
    // 这个需要前一天数据对比，如果 coin 对象有 previousDayExplosionIndex
    if (entryExitType === 'exit' && entryExitDay > 1 && 
        coin.previousDayExplosionIndex !== undefined && coin.previousDayExplosionIndex < 0 && explosionIndex >= 0) {
      return true; // 标记为空单止盈
    }
    return false;
  };