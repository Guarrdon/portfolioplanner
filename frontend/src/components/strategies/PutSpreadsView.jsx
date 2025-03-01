import React from 'react';
import { useLocation } from 'react-router-dom';
import StrategyView from './StrategyView';
import { useUser } from '../../contexts/UserContext';
import PutSpreadForm from '../forms/PutSpreadForm';
import { usePortfolio } from '../../contexts/PortfolioContext';

const PutSpreadsView = () => {
  const location = useLocation();
  const { ownedStrategies, sharedStrategies } = usePortfolio();
  const { currentUser } = useUser();

  // Get positions from both owned and shared strategies, ensuring uniqueness by ID
  const positions = React.useMemo(() => {
    // Clear positions if no user
    if (!currentUser?.id) return [];

    const ownedPositions = ownedStrategies?.putSpreads || [];
    const sharedPositions = sharedStrategies?.putSpreads || [];

    // Combine and deduplicate based on position ID
    const positionMap = new Map();
    [...ownedPositions, ...sharedPositions].forEach(position => {
      if (!positionMap.has(position.id)) {
        positionMap.set(position.id, position);
      }
    });

    return Array.from(positionMap.values());
  }, [ownedStrategies, sharedStrategies, currentUser?.id]);

  return (
    <StrategyView
      title="Put Option Spreads"
      description="Track your put spread strategies and manage risk"
      strategyType="putSpreads"
      positions={positions}
      FormComponent={PutSpreadForm}
      showForm={location.state?.showNewPositionForm}
    />
  );
};

export default PutSpreadsView;