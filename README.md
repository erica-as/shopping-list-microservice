# Sistema de Listas de Compras

**Microsserviços + API Gateway + Mensageria com RabbitMQ**

Este é um sistema distribuído para gerenciamento de listas de compras, desenvolvido com uma arquitetura moderna baseada em **microsserviços**, comunicação **síncrona e assíncrona**, e uso de padrões como:

- API Gateway
- Service Discovery
- Circuit Breaker
- Banco NoSQL Independente (Database per Service)
- Arquitetura Orientada a Eventos via RabbitMQ

O projeto simula um ecossistema real de serviços resilientes, escaláveis e bem desacoplados.

---

## Arquitetura do Sistema

O sistema é composto por múltiplos microsserviços independentes que se comunicam via:

- **HTTP (Axios)** → Chamadas síncronas
- **AMQP (RabbitMQ)** → Eventos assíncronos

### Componentes

#### API Gateway (Porta 3000)

- Único ponto de entrada para o cliente
- Roteamento para os microsserviços
- Agregação de dados para dashboards
- Implementação de Circuit Breaker
- Integração com Service Discovery

#### User Service (Porta 3001)

- Cadastro, login e autenticação com JWT
- Banco de dados dedicado: `users.json`

#### List Service (Porta 3002)

- Criação e edição de listas de compras
- Busca informações dos produtos no Item Service
- **Produtor de eventos** → Envia mensagens de checkout para RabbitMQ
- Banco de dados dedicado: `lists.json`

#### Item Service (Porta 3003)

- Catálogo com:

  - Nome
  - Categoria
  - Preço

- Banco de dados dedicado: `items.json`

#### Workers (Consumidores)

| Worker              | Função                                              |
| ------------------- | --------------------------------------------------- |
| Notification Worker | Escuta eventos de checkout e simula envio de e-mail |
| Analytics Worker    | Gera estatísticas de vendas                         |

#### 📡 Service Registry (shared)

Mecanismo simples de descoberta de serviços baseado em arquivo:

```
shared/services-registry.json
```

#### RabbitMQ (Broker de Mensagens)

Usado para comunicação assíncrona entre os serviços e workers.

---

## Tecnologias Utilizadas

- **Node.js + Express** – Base dos microsserviços
- **RabbitMQ** – Mensageria com AMQP
- **Axios** – Comunicação HTTP interna
- **JWT** – Autenticação
- **JSON File DB** – Banco NoSQL customizado
- **Docker (Opcional)** – Para rodar o RabbitMQ localmente

---

## Como Rodar o Projeto

### Pré-requisitos

- Node.js 16+
- RabbitMQ (local, Docker ou CloudAMQP)

### Configurar Ambiente

Crie um arquivo `.env` na raiz:

```env
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

Ou, se estiver usando CloudAMQP:

```env
RABBITMQ_URL=amqps://user:pass@host.cloudamqp.com/vhost
```

### Instalar Dependências

```bash
npm run install:all
```

### Iniciar API Gateway + Serviços

```bash
npm start
```

Aguarde pelos logs:

```
Service registrado
Health check OK
```

### Iniciar Workers

**Worker de Notificações:**

```bash
cd workers && npm run start:notification
```

**Worker de Analytics:**

```bash
cd workers && npm run start:analytics
```

---

## Como Testar

### Teste Completo (Client Demo)

O projeto inclui um script que:

- Verifica saúde do sistema
- Cria usuário
- Faz login
- Busca itens
- Cria lista
- Faz checkout assíncrono
- Exibe dashboard consolidado

Para rodar:

```bash
npm run demo
```

---

### Testar via Postman / cURL

#### Registrar Usuário

```
POST http://localhost:3000/api/auth/register
Content-Type: application/json

{
  "email": "teste@email.com",
  "username": "teste",
  "password": "123",
  "firstName": "João",
  "lastName": "Silva"
}
```

#### Criar Lista

```
POST http://localhost:3000/api/lists
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "name": "Minha Lista"
}
```

#### Checkout da Lista

```
POST http://localhost:3000/api/lists/<ID>/checkout
Authorization: Bearer <TOKEN>
```

Resposta esperada:

```
202 Accepted
```

---

## Estrutura de Pastas

```
/
├── api-gateway/            # Servidor do API Gateway
├── services/
│   ├── item-service/       # Microsserviço de produtos
│   ├── list-service/       # Microsserviço de listas
│   └── user-service/       # Microsserviço de autenticação
├── shared/                 # Código reutilizável (DB, Registry, MQ)
├── workers/                # Notification + Analytics
├── client-demo.js          # Simulação automática de cliente
├── reset-services.js       # Limpeza do registry
└── package.json            # Scripts globais
```

---

## Conceitos Demonstrados

- Microsserviços com isolamento total
- Resiliência com Circuit Breaker
- Comunicações síncrona e assíncrona
- Event-Driven Architecture
- Service Discovery simples
- Banco por serviço (Database per Service)

---

## 📜 Licença

Este projeto é de uso acadêmico e educacional.
