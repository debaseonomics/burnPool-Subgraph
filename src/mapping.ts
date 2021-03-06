import { BigDecimal, BigInt } from '@graphprotocol/graph-ts';
import {
	Contract,
	LogNewCouponCycle,
	LogOraclePriceAndPeriod,
	LogRewardClaimed,
	LogRewardsAccrued,
	LogSetCurveShifter,
	LogSetEpochs,
	LogSetInitialRewardShare,
	LogSetMeanAndDeviationWithFormulaConstants,
	LogSetMultiSigRewardShare,
	LogStartNewDistributionCycle,
	InitializeCall,
	LogSetOracleBlockPeriod,
	LogSetRewardBlockPeriod,
	LogCouponsBought,
	LogNeutralRebase,
	LogSetMaximumRewardAccruedCap,
	LogSetMinimumRewardAccruedCap,
	LogSetEnableMaximumRewardAccruedCap,
	LogSetEnableMinimumRewardAccruedCap
} from '../generated/Contract/Contract';
import { Setting, RewardCycle, ExpansionCycle, DistributionCycle, User } from '../generated/schema';

let DIVIDER_9_INT = BigInt.fromI32(1000000000);
let DIVIDER_9_DECIMAL = BigDecimal.fromString('1000000000');
let ZERO = BigInt.fromI32(0);
let ZERO_DECIMAL = BigDecimal.fromString('0');

let DIVIDER_18_DECIMAL = BigDecimal.fromString('1000000000000000000');

export function handleInitialize(call: InitializeCall): void {
	let setting = new Setting('0');
	let contract = Contract.bind(call.to);

	setting.epochs = call.inputs.epochs_;
	setting.oracleBlockPeriod = call.inputs.oracleBlockPeriod_;
	setting.curveShifter = call.inputs.curveShifter_.divDecimal(DIVIDER_18_DECIMAL);
	setting.initialRewardShare = call.inputs.initialRewardShare_.divDecimal(DIVIDER_18_DECIMAL);
	setting.multiSigRewardShare = call.inputs.multiSigRewardShare_.divDecimal(DIVIDER_18_DECIMAL);
	setting.rewardBlockPeriod = contract.rewardBlockPeriod();

	setting.mean = contract.bytes16ToUnit256(call.inputs.mean_, DIVIDER_9_INT).divDecimal(DIVIDER_9_DECIMAL);

	setting.deviation = contract.bytes16ToUnit256(call.inputs.deviation_, DIVIDER_9_INT).divDecimal(DIVIDER_9_DECIMAL);

	setting.rewardCycleLength = ZERO;

	setting.enableMinimumRewardAccruedCap = contract.enableMinimumRewardAccruedCap();
	setting.enableMaximumRewardAccruedCap = contract.enableMaximumRewardAccruedCap();
	setting.minimumRewardAccruedCap = contract.minimumRewardAccruedCap().divDecimal(DIVIDER_18_DECIMAL);
	setting.maximumRewardAccruedCap = contract.maximumRewardAccruedCap().divDecimal(DIVIDER_18_DECIMAL);

	setting.oneDivDeviationSqrtTwoPi = contract
		.bytes16ToUnit256(call.inputs.oneDivDeviationSqrtTwoPi_, DIVIDER_9_INT)
		.divDecimal(DIVIDER_9_DECIMAL);

	setting.twoDeviationSquare = contract
		.bytes16ToUnit256(call.inputs.twoDeviationSquare_, DIVIDER_9_INT)
		.divDecimal(DIVIDER_9_DECIMAL);

	setting.peakScaler = contract.bytes16ToUnit256(contract.peakScaler(), DIVIDER_9_INT).divDecimal(DIVIDER_9_DECIMAL);

	let rebase = contract.lastRebase();

	if (rebase === 0) {
		setting.lastRebase = 'POSITIVE';
	} else if (rebase === 1) {
		setting.lastRebase = 'NEUTRAL';
	} else if (rebase === 2) {
		setting.lastRebase = 'NEGATIVE';
	} else {
		setting.lastRebase = 'NONE';
	}

	setting.save();
}

export function handleLogCouponsBought(event: LogCouponsBought): void {
	let contract = Contract.bind(event.address);

	let id = contract.rewardCyclesLength().minus(BigInt.fromI32(1)).toString();
	let cycle = RewardCycle.load(id);
	let userId = event.params.buyer_.toHexString().concat('-').concat(id);

	let amount = event.params.amount_.divDecimal(DIVIDER_18_DECIMAL);
	let user = User.load(userId);

	if (user == null) {
		user = new User(userId);
		user.address = event.params.buyer_.toHexString();
		user.rewardCycle = id;
		user.debaseEarned = ZERO_DECIMAL;
		user.couponBalance = ZERO_DECIMAL;
		user.couponsIssued = ZERO_DECIMAL;

		let users = cycle.users;
		users.push(userId);
		cycle.users = users;
	}

	user.couponBalance = user.couponBalance.plus(amount);
	user.couponsIssued = cycle.couponsIssued.plus(amount);
	cycle.couponsIssued = cycle.couponsIssued.plus(amount);

	user.save();
	cycle.save();
}

export function handleLogNewCouponCycle(event: LogNewCouponCycle): void {
	let cycle = new RewardCycle(event.params.index_.toString());
	cycle.rewardShare = event.params.rewardAmount_.divDecimal(DIVIDER_18_DECIMAL);
	cycle.debasePerEpoch = event.params.debasePerEpoch_.divDecimal(DIVIDER_18_DECIMAL);
	cycle.rewardBlockPeriod = event.params.rewardBlockPeriod_;
	cycle.oracleBlockPeriod = event.params.oracleBlockPeriod_;
	cycle.epochsToReward = event.params.epochsToReward_;
	cycle.epochsRewarded = ZERO;
	cycle.couponsIssued = ZERO_DECIMAL;
	cycle.rewardDistributed = ZERO_DECIMAL;
	cycle.distributionStatus = 'WAITING_FOR_POSITIVE_REBASE';

	if (event.params.index_.notEqual(BigInt.fromI32(0))) {
		let lastCycle = RewardCycle.load(event.params.index_.minus(BigInt.fromI32(1)).toString());
		if (lastCycle.distributionStatus == 'IN_PROGRESS') {
			lastCycle.distributionStatus = 'ENDED_DUE_TO_NEGATIVE_REBASE';
		}
		lastCycle.save();
	}

	cycle.oracleLastPrices = [];
	cycle.oracleNextUpdates = [];

	let copy = cycle.oracleLastPrices;
	let copy2 = cycle.oracleNextUpdates;

	copy.push(event.params.oracleLastPrice_.divDecimal(DIVIDER_18_DECIMAL));
	copy2.push(event.params.oracleNextUpdate_);

	cycle.oracleLastPrices = copy;
	cycle.oracleNextUpdates = copy2;

	let setting = Setting.load('0');
	setting.rewardCycleLength = event.params.index_.plus(BigInt.fromI32(1));
	setting.lastRebase = 'NEGATIVE';

	setting.save();
	cycle.save();
}

export function handleLogOraclePriceAndPeriod(event: LogOraclePriceAndPeriod): void {
	let contract = Contract.bind(event.address);
	let id = contract.rewardCyclesLength().minus(BigInt.fromI32(1));
	let cycle = RewardCycle.load(id.toString());

	let oracleLastPrice = cycle.oracleLastPrices;
	let oracleNextUpdate = cycle.oracleNextUpdates;

	oracleLastPrice.push(event.params.price_.divDecimal(DIVIDER_18_DECIMAL));
	oracleNextUpdate.push(event.params.period_);

	cycle.oracleLastPrices = oracleLastPrice;
	cycle.oracleNextUpdates = oracleNextUpdate;

	cycle.save();
}

export function handleLogRewardClaimed(event: LogRewardClaimed): void {
	let id = event.params.cycleIndex_.toString();

	let cycle = RewardCycle.load(id);
	let userId = event.params.user_.toHexString().concat('-').concat(id);
	let user = User.load(userId);

	cycle.rewardDistributed = event.params.rewardClaimed_.divDecimal(DIVIDER_18_DECIMAL);
	user.debaseEarned = user.debaseEarned.plus(event.params.rewardClaimed_.divDecimal(DIVIDER_18_DECIMAL));

	user.save();
	cycle.save();
}

export function handleLogRewardsAccrued(event: LogRewardsAccrued): void {
	let expansionCycle = ExpansionCycle.load(event.params.index.toString());
	if (expansionCycle == null) {
		expansionCycle = new ExpansionCycle(event.params.index.toString());

		expansionCycle.exchangeRate = [];
		expansionCycle.cycleExpansion = [];
		expansionCycle.curveValue = [];
		expansionCycle.mean = [];
		expansionCycle.deviation = [];
		expansionCycle.peakScaler = [];
	}

	expansionCycle.rewardAccrued = event.params.rewardsAccrued_.divDecimal(DIVIDER_18_DECIMAL);

	let exchangeRate = expansionCycle.exchangeRate;
	let cycleExpansion = expansionCycle.cycleExpansion;
	let curveValue = expansionCycle.curveValue;
	let mean = expansionCycle.mean;
	let deviation = expansionCycle.deviation;
	let peakScaler = expansionCycle.peakScaler;

	exchangeRate.push(event.params.exchangeRate_.divDecimal(DIVIDER_18_DECIMAL));
	cycleExpansion.push(event.params.expansionPercentageScaled_.divDecimal(DIVIDER_18_DECIMAL));

	let contract = Contract.bind(event.address);
	let setting = Setting.load('0');

	curveValue.push(contract.bytes16ToUnit256(event.params.value_, DIVIDER_9_INT).divDecimal(DIVIDER_9_DECIMAL));

	mean.push(setting.mean);
	deviation.push(setting.deviation);
	peakScaler.push(setting.peakScaler);

	expansionCycle.exchangeRate = exchangeRate;
	expansionCycle.cycleExpansion = cycleExpansion;
	expansionCycle.curveValue = curveValue;
	expansionCycle.mean = mean;
	expansionCycle.deviation = deviation;
	expansionCycle.peakScaler = peakScaler;

	if (event.params.index.notEqual(BigInt.fromI32(0))) {
		let rewardCycle = RewardCycle.load(event.params.index.minus(BigInt.fromI32(1)).toString());
		if ((rewardCycle.distributionStatus = 'WAITING_FOR_POSITIVE_REBASE')) {
			rewardCycle.distributionStatus = 'IN_PROGRESS';
			rewardCycle.save();
		}
	}

	setting.lastRebase = 'POSITIVE';

	setting.save();
	expansionCycle.save();
}

export function handleNeutralRebase(event: LogNeutralRebase): void {
	let setting = Setting.load('0');

	let contract = Contract.bind(event.address);
	let id = contract.rewardCyclesLength().minus(BigInt.fromI32(1));
	let cycle = RewardCycle.load(id.toString());

	if (cycle != null && cycle.distributionStatus == 'IN_PROGRESS') {
		cycle.distributionStatus = 'ENDED_DUE_TO_NEUTRAL_REBASE';
		cycle.save();
	}

	setting.lastRebase = 'NEUTRAL';
	setting.save();
}

export function handleLogSetMinimumRewardAccruedCap(event: LogSetMinimumRewardAccruedCap): void {
	let setting = Setting.load('0');
	setting.minimumRewardAccruedCap = event.params.minimumRewardAccruedCap_.divDecimal(DIVIDER_18_DECIMAL);
	setting.save();
}
export function handleLogSetMaximumRewardAccruedCap(event: LogSetMaximumRewardAccruedCap): void {
	let setting = Setting.load('0');
	setting.maximumRewardAccruedCap = event.params.maximumRewardAccruedCap_.divDecimal(DIVIDER_18_DECIMAL);
	setting.save();
}
export function handleLogSetEnableMinimumRewardAccruedCap(event: LogSetEnableMinimumRewardAccruedCap): void {
	let setting = Setting.load('0');
	setting.enableMinimumRewardAccruedCap = event.params.enableMinimumRewardAccruedCap_;
	setting.save();
}
export function handleLogSetEnableMaximumRewardAccruedCap(event: LogSetEnableMaximumRewardAccruedCap): void {
	let setting = Setting.load('0');
	setting.enableMaximumRewardAccruedCap = event.params.enableMaximumRewardAccruedCap_;
	setting.save();
}

export function handleLogSetRewardBlockPeriod(event: LogSetRewardBlockPeriod): void {
	let setting = Setting.load('0');
	setting.rewardBlockPeriod = event.params.rewardBlockPeriod_;
	setting.save();
}

export function handleLogSetCurveShifter(event: LogSetCurveShifter): void {
	let setting = Setting.load('0');
	setting.curveShifter = event.params.curveShifter_.divDecimal(DIVIDER_18_DECIMAL);
	setting.save();
}

export function handleLogSetEpochs(event: LogSetEpochs): void {
	let setting = Setting.load('0');
	setting.epochs = event.params.epochs_;
	setting.save();
}

export function handleLogSetInitialRewardShare(event: LogSetInitialRewardShare): void {
	let setting = Setting.load('0');
	setting.initialRewardShare = event.params.initialRewardShare_.divDecimal(DIVIDER_18_DECIMAL);
	setting.save();
}

export function handleLogSetMeanAndDeviationWithFormulaConstants(
	event: LogSetMeanAndDeviationWithFormulaConstants
): void {
	let setting = Setting.load('0');
	let contract = Contract.bind(event.address);

	setting.mean = contract.bytes16ToUnit256(event.params.mean_, DIVIDER_9_INT).divDecimal(DIVIDER_9_DECIMAL);

	setting.deviation = contract.bytes16ToUnit256(event.params.deviation_, DIVIDER_9_INT).divDecimal(DIVIDER_9_DECIMAL);

	setting.peakScaler = contract
		.bytes16ToUnit256(event.params.peakScaler_, DIVIDER_9_INT)
		.divDecimal(DIVIDER_9_DECIMAL);

	setting.oneDivDeviationSqrtTwoPi = contract
		.bytes16ToUnit256(event.params.oneDivDeviationSqrtTwoPi_, DIVIDER_9_INT)
		.divDecimal(DIVIDER_9_DECIMAL);

	setting.twoDeviationSquare = contract
		.bytes16ToUnit256(event.params.twoDeviationSquare_, DIVIDER_9_INT)
		.divDecimal(DIVIDER_9_DECIMAL);

	setting.save();
}

export function handleLogSetMultiSigRewardShare(event: LogSetMultiSigRewardShare): void {
	let setting = Setting.load('0');
	setting.multiSigRewardShare = event.params.multiSigRewardShare_.divDecimal(DIVIDER_18_DECIMAL);
	setting.save();
}

export function handleLogSetOracleBlockPeriod(event: LogSetOracleBlockPeriod): void {
	let setting = Setting.load('0');
	setting.oracleBlockPeriod = event.params.oracleBlockPeriod_;
	setting.save();
}

export function handleLogStartNewDistributionCycle(event: LogStartNewDistributionCycle): void {
	let contract = Contract.bind(event.address);
	let distributionId = event.block.hash.toHex();
	let id = contract.rewardCyclesLength().minus(BigInt.fromI32(1));

	let setting = Setting.load('0');

	let distributionCycle = new DistributionCycle(distributionId);

	distributionCycle.rewardCycle = id.toString();

	distributionCycle.poolTotalShare = event.params.poolShareAdded_.divDecimal(DIVIDER_18_DECIMAL);

	distributionCycle.rewardRate = event.params.rewardRate_.divDecimal(DIVIDER_18_DECIMAL);

	distributionCycle.periodFinish = event.params.periodFinish_;

	distributionCycle.exchangeRate = event.params.exchangeRate_.divDecimal(DIVIDER_18_DECIMAL);

	distributionCycle.mean = setting.mean;
	distributionCycle.deviation = setting.deviation;
	distributionCycle.peakScaler = setting.peakScaler;
	distributionCycle.blockNumber = event.block.number;

	distributionCycle.curveValue = contract
		.bytes16ToUnit256(event.params.curveValue_, DIVIDER_9_INT)
		.divDecimal(DIVIDER_9_DECIMAL);

	distributionCycle.save();

	let rewardCycle = RewardCycle.load(id.toString());

	let distributions = rewardCycle.distributions;

	distributions.push(distributionId);

	rewardCycle.distributions = distributions;

	rewardCycle.epochsRewarded = rewardCycle.epochsRewarded.plus(BigInt.fromI32(1));

	if (rewardCycle.epochsRewarded.equals(rewardCycle.epochsToReward)) {
		rewardCycle.distributionStatus = 'EPOCHS_COMPLETED';
	}

	rewardCycle.save();
}
