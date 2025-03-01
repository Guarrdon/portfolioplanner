import React from 'react';
import { useLocation } from 'react-router-dom';
import StrategyView from './StrategyView';
import BigOptionForm from '../forms/BigOptionForm';
import { usePortfolio } from '../../contexts/PortfolioContext';

const BigOptionsView = () => {
  const location = useLocation();
  const { ownedStrategies, sharedStrategies } = usePortfolio();

  // Get positions from both owned and shared strategies, ensuring uniqueness by ID
  const positions = React.useMemo(() => {
    const ownedPositions = ownedStrategies?.bigOptions || [];
    const sharedPositions = sharedStrategies?.bigOptions || [];
    
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
      title="Big Options"
      description="Monitor significant option positions and track performance"
      strategyType="bigOptions"
      positions={positions}
      FormComponent={BigOptionForm}
      showForm={location.state?.showNewPositionForm}
    />
  );
};

export default BigOptionsView;