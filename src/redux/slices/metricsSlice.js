// src/redux/slices/coinsSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  metrics: [],
  loading: false,
  error: null,
};

const metricsSlice = createSlice({
  name: 'metrics',
  initialState,
  reducers: {
    fetchCoinsStart(state) {
      state.loading = true;
      state.error = null;
    },
    fetchCoinsSuccess(state, action) {
      state.metrics = action.payload;
      state.loading = false;
    },
    fetchCoinsFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
  },
});

export const { fetchCoinsStart, fetchCoinsSuccess, fetchCoinsFailure } = metricsSlice.actions;
export default metricsSlice.reducer;