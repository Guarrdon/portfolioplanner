// src/components/strategies/CoveredCallsView.jsx

import React, { useEffect }  from 'react';
import { useLocation } from 'react-router-dom';
import StrategyView from './StrategyView';
import { useUser } from '../../contexts/UserContext';
import CoveredCallForm from '../forms/CoveredCallForm';
import { usePortfolio } from '../../contexts/PortfolioContext';

const CoveredCallsView = () => {
  const location = useLocation();
  const { ownedStrategies, sharedStrategies } = usePortfolio();
  const { currentUser } = useUser();
  
  useEffect(() => {
    //console.log('CoveredCallsView mounted');
    return () => console.log('CoveredCallsView unmounted');
  }, []);

  const positions = React.useMemo(() => {
    // Clear positions if no user
    if (!currentUser?.id) return [];
    
    const ownedPositions = ownedStrategies?.coveredCalls || [];
    const sharedPositions = sharedStrategies?.coveredCalls || [];
    
    // Combine and deduplicate based on position ID AND originalId
    const positionMap = new Map();
    // Add owned positions first
    ownedPositions.forEach(position => {
      positionMap.set(position.id, position);
    });
    
    // Only add shared positions if they don't have a matching id or originalId
    sharedPositions.forEach(position => {
      if (!positionMap.has(position.id) && 
          !ownedPositions.some(p => p.id === position.originalId)) {
        positionMap.set(position.id, position);
      }
    });
    
    return Array.from(positionMap.values());
  }, [ownedStrategies, sharedStrategies, currentUser?.id]);

  return (
    <StrategyView
      title="Covered Calls"
      description="Manage your covered call positions and track premium collection"
      strategyType="coveredCalls"
      positions={positions}
      FormComponent={CoveredCallForm}
      showForm={location.state?.showNewPositionForm}
    />
  );
};

export default CoveredCallsView;