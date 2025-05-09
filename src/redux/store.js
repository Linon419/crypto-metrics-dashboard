import { configureStore } from '@reduxjs/toolkit';
import coinsReducer from './slices/coinsSlice';
import metricsReducer from './slices/metricsSlice';
import liquidityReducer from './slices/liquiditySlice';

export const store = configureStore({
  reducer: {
    coins: coinsReducer,
    metrics: metricsReducer,
    liquidity: liquidityReducer,
  },
});