import { ethers } from 'ethers';
import axios from 'axios';

// Constants
const RPC_URL = 'https://mainnet.base.org';
const DEX_ROUTER_ADDRESS = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24';
const BASE_TOKEN = '0x4200000000000000000000000000000000000006';

// Initialize Provider and Wallet
console.log('Initializing Trading Bot...');
const provider = new ethers.JsonRpcProvider(RPC_URL);
console.log(`Using Base RPC URL: ${RPC_URL}`);

// Handle private key securely and validate
const rawPrivateKey = process.env.PRIVATE_KEY?.trim();
if (!rawPrivateKey) {
  console.error('Private key is missing! Please ensure PRIVATE_KEY is set in the environment variables.');
  process.exit(1);
}
const formattedPrivateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;

let wallet;
try {
  wallet = new ethers.Wallet(formattedPrivateKey, provider);
  console.log(`Wallet Address: ${wallet.address}`);
} catch (error) {
  console.error('Invalid private key:', error.message);
  process.exit(1);
}

const dexAbi = [
  'function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] memory path, address to, uint256 deadline) external',
];
const dexRouter = new ethers.Contract(DEX_ROUTER_ADDRESS, dexAbi, wallet);
console.log(`DEX Router Address: ${DEX_ROUTER_ADDRESS}`);

// Test Axios
console.log('Testing Axios...');
axios
  .get('https://api.coingecko.com/api/v3/ping')
  .then((response) => {
    console.log('Axios Test Successful:', response.data);
  })
  .catch((error) => {
    console.error('Axios Test Failed:', error.message);
  });

// Fetch Wallet Balances
async function getWalletBalances() {
  console.log('Fetching wallet balances...');
  const tokenAbi = ['function balanceOf(address owner) public view returns (uint256)'];
  const tokens = await fetchTopTokens();
  const balances = {};

  for (const token of tokens) {
    try {
      const tokenContract = new ethers.Contract(token.address, tokenAbi, provider);
      const balance = await tokenContract.balanceOf(wallet.address);
      balances[token.symbol] = ethers.formatEther(balance);
      console.log(`Balance for ${token.symbol}: ${balances[token.symbol]}`);
    } catch (error) {
      console.error(`Error fetching balance for ${token.symbol}:`, error.message);
    }
  }

  const ethBalance = await provider.getBalance(wallet.address);
  balances['ETH'] = ethers.formatEther(ethBalance);
  console.log(`Base ETH balance: ${balances['ETH']}`);
  return balances;
}

// Fetch Top Tokens by Volume
async function fetchTopTokens() {
  console.log('Fetching top tokens by volume...');
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'volume_desc',
        per_page: 5,
        page: 1,
        category: 'base-network',
      },
    });
    const tokens = response.data.map((token) => ({
      id: token.id,
      symbol: token.symbol,
      address: token.contract_address,
      volume: token.total_volume,
    }));
    console.log('Top tokens fetched:', tokens.map((t) => t.symbol).join(', '));
    return tokens;
  } catch (error) {
    console.error('Error fetching top tokens:', error.message);
    return [];
  }
}

// Fetch Historical Data for a Token
async function fetchHistoricalData(tokenId) {
  console.log(`Fetching historical data for ${tokenId}...`);
  try {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/${tokenId}/market_chart`, {
      params: {
        vs_currency: 'usd',
        days: '7', // Fetch past 7 days' data
      },
    });
    console.log(`Historical data for ${tokenId} fetched successfully.`);
    return response.data.prices; // Array of [timestamp, price]
  } catch (error) {
    console.error(`Error fetching historical data for ${tokenId}:`, error.message);
    return [];
  }
}

// Analyze Historical Price Trends
function analyzeTrends(historicalData) {
  if (historicalData.length === 0) {
    console.warn('No historical data available to analyze trends.');
    return false;
  }

  const prices = historicalData.map((entry) => entry[1]); // Extract prices
  const currentPrice = prices[prices.length - 1];
  const averagePrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;

  console.log(`Current Price: ${currentPrice}, Average Price: ${averagePrice}`);
  return currentPrice < averagePrice * 0.9; // 10% below average
}

// Execute Trades Based on Analysis
async function executeBalancedTrades() {
  console.log('Starting trade execution...');
  const tokens = await fetchTopTokens();
  const balances = await getWalletBalances();

  for (const token of tokens) {
    const tokenIn = token.address;
    const ethBalance = ethers.parseEther(balances['ETH'] || '0');

    if (ethBalance.gt(0)) {
      console.log(`Evaluating trade for token: ${token.symbol}`);
      const historicalData = await fetchHistoricalData(token.id);
      const shouldTrade = analyzeTrends(historicalData);

      if (shouldTrade) {
        try {
          const path = [BASE_TOKEN, tokenIn];
          const amountsOut = await dexRouter.getAmountsOut(ethBalance, path);
          const amountOut = ethers.formatEther(amountsOut[1]);

          console.log(`Token: ${token.symbol}, ETH Amount: ${balances['ETH']}, Expected Token Out: ${amountOut}`);
          const minProfit = '0.001'; // Hardcoded minimum profit in BASE_TOKEN
          if (parseFloat(amountOut) >= parseFloat(minProfit)) {
            const tx = await dexRouter.swapExactTokensForTokens(
              ethBalance,
              ethers.parseEther(minProfit.toString()),
              path,
              wallet.address,
              Math.floor(Date.now() / 1000) + 60 * 20
            );
            console.log(`Trade executed for ${token.symbol}: TX Hash = ${tx.hash}`);
          } else {
            console.log(`Trade skipped for ${token.symbol}: Profit threshold not met.`);
          }
        } catch (error) {
          console.error(`Error executing trade for ${token.symbol}:`, error.message);
        }
      } else {
        console.log(`Trade skipped for ${token.symbol}: Current price is not favorable.`);
      }
    } else {
      console.log('No ETH balance available for trading.');
    }
  }
}

// Serverless Function Handler
export default async function handler(req, res) {
  console.log('Bot triggered...');
  try {
    await executeBalancedTrades();
    res.status(200).json({ message: 'Trades executed successfully or skipped if not favorable.' });
  } catch (error) {
    console.error('Error in bot execution:', error.message);
    res.status(500).json({ error: error.message });
  }
}
