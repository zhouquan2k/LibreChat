import React, { useMemo } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import { useAgentsMapContext } from '~/Providers';
import Icon from '~/components/Endpoints/Icon';

interface AgentUpdateProps {
  currentAgentId: string;
  status?: string;
  nodeId?: string;
}

const AgentUpdate: React.FC<AgentUpdateProps> = ({ currentAgentId, status, nodeId }) => {
  const agentsMap = useAgentsMapContext() || {};
  const currentAgent = useMemo(() => agentsMap[currentAgentId], [agentsMap, currentAgentId]);
  
  // 如果没有代理ID，则不显示
  if (!currentAgentId) {
    return null;
  }
  
  // 组合状态和节点ID
  const displayStatus = useMemo(() => {
    if (!status) return '';
    if (nodeId) {
      return `${status} (${nodeId})`;
    }
    return status;
  }, [status, nodeId]);
  
  return (
    <div className="relative">
      <div className="absolute -left-6 flex h-full w-4 items-center justify-center">
        <div className="relative h-full w-4">
          <div className="absolute left-0 top-0 h-1/2 w-px border border-border-medium"></div>
          <div className="absolute left-0 top-1/2 h-px w-3 border border-border-medium"></div>
        </div>
      </div>
      <div className="my-4 flex flex-col">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full">
            <Icon
              endpoint={EModelEndpoint.agents}
              agentName={currentAgent?.name ?? ''}
              iconURL={currentAgent?.avatar?.filepath}
              isCreatedByUser={false}
            />
          </div>
          <div className="font-medium text-text-primary">{currentAgent?.name}</div>
        </div>
        {displayStatus && (
          <div className="ml-8 mt-1 text-sm text-text-secondary">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500"></span>
              </span>
              <span>{displayStatus}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentUpdate;
