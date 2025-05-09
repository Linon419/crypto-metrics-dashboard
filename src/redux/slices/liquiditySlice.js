// src/redux/slices/coinsSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  liquidity: [],
  loading: false,
  error: null,
};

const liquiditySlice = createSlice({
  name: 'liquidity',
  initialState,
  reducers: {
    fetchCoinsStart(state) {
      state.loading = true;
      state.error = null;
    },
    fetchCoinsSuccess(state, action) {
      state.liquidity = action.payload;
      state.loading = false;
    },
    fetchCoinsFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
  },
});

export const { fetchCoinsStart, fetchCoinsSuccess, fetchCoinsFailure } = liquiditySlice.actions;
export default liquiditySlice.reducer;