// src/redux/slices/coinsSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  coins: [],
  loading: false,
  error: null,
};

const coinsSlice = createSlice({
  name: 'coins',
  initialState,
  reducers: {
    fetchCoinsStart(state) {
      state.loading = true;
      state.error = null;
    },
    fetchCoinsSuccess(state, action) {
      state.coins = action.payload;
      state.loading = false;
    },
    fetchCoinsFailure(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
  },
});

export const { fetchCoinsStart, fetchCoinsSuccess, fetchCoinsFailure } = coinsSlice.actions;
export default coinsSlice.reducer;