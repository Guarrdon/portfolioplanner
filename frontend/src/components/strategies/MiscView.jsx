import React from 'react';
import { useLocation } from 'react-router-dom';
import StrategyView from './StrategyView';
import MiscForm from '../forms/MiscForm';
import { usePortfolio } from '../../contexts/PortfolioContext';

const MiscView = () => {
  const location = useLocation();
  const { ownedStrategies, sharedStrategies } = usePortfolio();

  // Get positions from both owned and shared strategies, ensuring uniqueness by ID
  const positions = React.useMemo(() => {
    const ownedPositions = ownedStrategies?.misc || [];
    const sharedPositions = sharedStrategies?.misc || [];
    
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
      title="Miscellaneous Positions"
      description="Manage other investment positions and strategies"
      strategyType="misc"
      positions={positions}
      FormComponent={MiscForm}
      showForm={location.state?.showNewPositionForm}
    />
  );
};

export default MiscView;