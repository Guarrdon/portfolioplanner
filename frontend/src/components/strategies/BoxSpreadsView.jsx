import React from 'react';
import { useLocation } from 'react-router-dom';
import StrategyView from './StrategyView';
import BOXSpreadForm from '../forms/BOXSpreadForm1';
import { usePortfolio } from '../../contexts/PortfolioContext';

const BOXSpreadsView = () => {
  const location = useLocation();
  const { ownedStrategies, sharedStrategies } = usePortfolio();

  // Get positions from both owned and shared strategies, ensuring uniqueness by ID
  const positions = React.useMemo(() => {
    const ownedPositions = ownedStrategies?.boxSpreads || [];
    const sharedPositions = sharedStrategies?.boxSpreads || [];
    
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
      title="Margin Spreads"
      description="Track your Box and Iron Fly spread synthetic loan positions"
      strategyType="boxSpreads"
      positions={positions}
      FormComponent={BOXSpreadForm}
      showForm={location.state?.showNewPositionForm}
    />
  );
};

export default BOXSpreadsView;