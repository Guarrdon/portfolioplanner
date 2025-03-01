import React from 'react';
import { useLocation } from 'react-router-dom';
import StrategyView from './StrategyView';
import DividendForm from '../forms/DividendForm';
import { usePortfolio } from '../../contexts/PortfolioContext';

const DividendsView = () => {
  const location = useLocation();
  const { ownedStrategies, sharedStrategies } = usePortfolio();

  // Get positions from both owned and shared strategies, ensuring uniqueness by ID
  const positions = React.useMemo(() => {
    const ownedPositions = ownedStrategies?.dividends || [];
    const sharedPositions = sharedStrategies?.dividends || [];
    
    // Combine and deduplicate based on position ID
    const positionMap = new Map();
    [...ownedPositions, ...sharedPositions].forEach(position => {
      if (!positionMap.has(position.id)) {
        positionMap.set(position.id, position);
      }
    });
    
    return Array.from(positionMap.values());
  }, [ownedStrategies, sharedStrategies]);

  return (
    <StrategyView
      title="Dividend Positions"
      description="Track your dividend-focused investments and income"
      strategyType="dividends"
      positions={positions}
      FormComponent={DividendForm}
      showForm={location.state?.showNewPositionForm}
    />
  );
};

export default DividendsView;