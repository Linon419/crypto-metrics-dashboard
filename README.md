# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

```
crypto-metrics-dashboard
├─ .dockerignore
├─ Dockerfile
├─ README.md
├─ database.sqlite
├─ docker-compose.yml
├─ package-lock.json
├─ package.json
├─ postcss.config.js
├─ public
│  ├─ favicon.ico
│  ├─ index.html
│  ├─ logo192.png
│  ├─ logo512.png
│  ├─ manifest.json
│  └─ robots.txt
├─ seeders
│  └─ 20250510032835-demo-coins.js
├─ server
│  ├─ config
│  │  └─ config.json
│  ├─ index.js
│  ├─ middleware
│  │  └─ auth.js
│  ├─ migrations
│  │  ├─ 20250509053304-create-coin.js
│  │  ├─ 20250509053343-create-daily-metric.js
│  │  ├─ 20250509053343-create-liquidity-overview.js
│  │  ├─ 20250509053344-create-trending-coin.js
│  │  └─ 20250510063333-create-user.js
│  ├─ models
│  │  ├─ coin.js
│  │  ├─ dailymetric.js
│  │  ├─ index.js
│  │  ├─ liquidityoverview.js
│  │  ├─ trendingcoin.js
│  │  └─ user.js
│  ├─ package.json
│  ├─ routes
│  │  ├─ auth.js
│  │  ├─ coins.js
│  │  ├─ dashboard.js
│  │  ├─ data.js
│  │  ├─ debug.js
│  │  ├─ liquidity.js
│  │  └─ metrics.js
│  ├─ scripts
│  │  ├─ createAdmin.js
│  │  └─ fixDatabase.js
│  ├─ seeders
│  └─ services
│     └─ openaiService.js
├─ src
│  ├─ App.css
│  ├─ App.js
│  ├─ App.test.js
│  ├─ components
│  │  ├─ ChangePassword.jsx
│  │  ├─ CoinCard.jsx
│  │  ├─ CoinDetailChart.jsx
│  │  ├─ CoinList.jsx
│  │  ├─ Dashboard.jsx
│  │  ├─ DataInputForm.jsx
│  │  ├─ LoadingPlaceholder.jsx
│  │  ├─ LiquidityChart.jsx
│  │  ├─ Login.jsx
│  │  ├─ OtcIndexTable.jsx
│  │  ├─ ProtectedRoute.jsx
│  │  ├─ Register.jsx
│  │  ├─ SearchBar.jsx
│  │  └─ UserProfile.jsx
│  ├─ helpers
│  │  └─ strategyAdvisor.js
│  ├─ hooks
│  │  └─ useApi.js
│  ├─ index.css
│  ├─ index.js
│  ├─ logo.svg
│  ├─ redux
│  │  ├─ slices
│  │  │  ├─ authSlice.js
│  │  │  ├─ coinsSlice.js
│  │  │  ├─ liquiditySlice.js
│  │  │  └─ metricsSlice.js
│  │  └─ store.js
│  ├─ reportWebVitals.js
│  ├─ services
│  │  └─ api.js
│  └─ setupTests.js
└─ tailwind.config.js
