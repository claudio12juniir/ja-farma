const BASE_URL = 'https://api.nfse.io';

function getApiKey() {
  const key = process.env.NFEIO_API_KEY;
  if (!key) throw new Error('NFEIO_API_KEY não configurada.');
  return key;
}

async function request(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': getApiKey()
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const texto = await res.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch (e) { data = texto; }

  if (!res.ok) {
    const msg = (data && (data.message || data.title || data.Message)) || `Erro NFe.io (HTTP ${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Cria ou atualiza a Empresa emissora na NFe.io. Se já existir nfeioCompanyId,
// atualiza; senão cria e devolve o Id novo pra ser salvo em empresa_emissora.
async function upsertCompany(nfeioCompanyId, companyPayload) {
  const body = { Company: companyPayload };
  const data = nfeioCompanyId
    ? await request('PUT', `/v2/companies/${nfeioCompanyId}`, body)
    : await request('POST', '/v2/companies', body);
  return (data && (data.company || data.Company)) || data;
}

async function issueProductInvoice(nfeioCompanyId, invoicePayload) {
  return request('POST', `/v2/companies/${nfeioCompanyId}/productinvoices`, invoicePayload);
}

async function getProductInvoice(nfeioCompanyId, invoiceId) {
  return request('GET', `/v2/companies/${nfeioCompanyId}/productinvoices/${invoiceId}`);
}

// Monta o payload de emissão a partir do que está cadastrado (empresa, cliente,
// produtos) — nunca inventa ou calcula classificação fiscal/alíquota, só usa
// exatamente o que foi informado por quem cadastrou a empresa/o produto. Se
// faltar algum dado fiscal obrigatório por item, bloqueia a emissão em vez de
// mandar um valor vazio/zerado.
function buildInvoicePayload({ cliente, itens, operationNature }) {
  const camposFaltando = [];
  itens.forEach(({ produto }) => {
    if (!produto.ncm) camposFaltando.push(`${produto.nome}: NCM`);
    if (!produto.cfop) camposFaltando.push(`${produto.nome}: CFOP`);
  });
  if (camposFaltando.length > 0) {
    const err = new Error(
      `Complete o cadastro fiscal do produto antes de emitir a nota: ${camposFaltando.join('; ')}`
    );
    err.code = 'FISCAL_INCOMPLETO';
    throw err;
  }

  const items = itens.map(({ produto, quantidade, valorUnitario }) => {
    const totalAmount = Number((quantidade * valorUnitario).toFixed(2));
    return {
      code: String(produto.id),
      description: produto.nome,
      ncm: produto.ncm,
      cfop: Number(produto.cfop),
      unit: produto.unidade_medida || 'UN',
      quantity: quantidade,
      unitAmount: valorUnitario,
      totalAmount,
      tax: {
        icms: {
          origin: produto.origem_icms || '0',
          csosn: produto.csosn || undefined
        },
        pis: produto.cst_pis ? { cst: produto.cst_pis } : undefined,
        cofins: produto.cst_cofins ? { cst: produto.cst_cofins } : undefined
      }
    };
  });

  const totalInvoiceAmount = Number(items.reduce((acc, i) => acc + i.totalAmount, 0).toFixed(2));

  return {
    operationNature: operationNature || 'Venda de mercadoria',
    operationType: 'Outgoing',
    destination: 'InternalOperation',
    consumerType: 'Normal',
    presenceType: 'Internet',
    payment: [{ paymentDetail: [{ method: 'Cash', paymentType: 'InCash', amount: totalInvoiceAmount }] }],
    buyer: {
      name: cliente.nome,
      federalTaxNumber: Number(String(cliente.cnpj || '').replace(/\D/g, '')),
      email: cliente.email || undefined,
      stateTaxNumber: cliente.ie || undefined,
      address: {
        state: cliente.uf,
        city: { code: cliente.codigo_ibge_cidade, name: cliente.cidade },
        district: cliente.bairro,
        street: cliente.logradouro,
        number: cliente.numero,
        postalCode: String(cliente.cep || '').replace(/\D/g, ''),
        country: 'BRA'
      }
    },
    items
  };
}

module.exports = { upsertCompany, issueProductInvoice, getProductInvoice, buildInvoicePayload };
