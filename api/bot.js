import { ethers } from 'ethers';
import axios from 'axios';

// Hardcoded Base RPC URL and Uniswap V2 Router02 Address
const RPC_URL = 'https://mainnet.base.org';
const DEX_ROUTER_ADDRESS = '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24';
const BASE_TOKEN = '0x4200000000000000000000000000000000000006'; // Base-native token (WETH equivalent)

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const dexAbi = [
  'function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[])',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] memory path, address to, uint256 deadline) external',
];
const dexRouter = new ethers.Contract(DEX_ROUTER_ADDRESS, dexAbi, wallet);

// Fetch wallet balances
async function getWalletBalances() {
  const tokenAbi = ['function balanceOf(address owner) public view returns (uint256)'];
  const tokens = await fetchTopTokens();
  const balances = {};

  for (const token of tokens) {
    const tokenContract = new ethers.Contract(token.address, tokenAbi, provider);
    const balance = await tokenContract.balanceOf(wallet.address);
    balances[token.symbol] = ethers.formatEther(balance);
  }

  return balances;
}

// Fetch top tokens by volume
async function fetchTopTokens() {
  const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
    params: {
      vs_currency: 'usd',
      order: 'volume_desc',
      per_page: 5,
      page: 1,
      category: 'base-network',
    },
  });

  return response.data.map((token) => ({
    id: token.id,
    symbol: token.symbol,
    address: token.contract_address,
    volume: token.total_volume,
  }));
}

// Execute balanced trades
async function executeBalancedTrades() {
  const tokens = await fetchTopTokens();
  const balances = await getWalletBalances();

  for (const token of tokens) {
    const tokenIn = token.address;
    const amountIn = ethers.parseEther(balances[token.symbol] || '0');

    if (amountIn.gt(0)) {
      const path = [tokenIn, BASE_TOKEN];
      const amountsOut = await dexRouter.getAmountsOut(amountIn, path);
      const amountOut = ethers.formatEther(amountsOut[1]);

      const minProfit = '0.001'; // Hardcoded minimum profit in BASE_TOKEN
      if (parseFloat(amountOut) >= parseFloat(minProfit)) {
        const tx = await dexRouter.swapExactTokensForTokens(
          amountIn,
          ethers.parseEther(minProfit.toString()),
          path,
          wallet.address,
          Math.floor(Date.now() / 1000) + 60 * 20
        );
        console.log(`Trade executed for ${token.symbol}: TX Hash = ${tx.hash}`);
      } else {
        console.log(`Trade skipped for ${token.symbol}: Profit threshold not met.`);
      }
    } else {
      console.log(`No balance for ${token.symbol}, skipping trade.`);
    }
  }
}

// Serverless function handler
export default async function handler(req, res) {
  try {
    await executeBalancedTrades();
    res.status(200).json({ message: 'Trades executed successfully or skipped if not profitable.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
