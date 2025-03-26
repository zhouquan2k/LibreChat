FROM node:18-bullseye

# 安装基本工具
RUN apt-get update && apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    sudo

# 设置Docker GID参数
ARG DOCKER_GID=999

# 创建docker组，使用主机相同的GID
RUN groupadd -g ${DOCKER_GID} docker || groupmod -g ${DOCKER_GID} docker

# 设置vscode用户并添加到docker组
RUN useradd -m -s /bin/bash vscode
RUN usermod -aG docker vscode
RUN usermod -aG sudo vscode
RUN echo "vscode ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vscode

RUN mkdir -p /workspaces && chown -R vscode:vscode /workspaces
WORKDIR /workspaces
