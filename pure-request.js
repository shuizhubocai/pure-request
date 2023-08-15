/**
 * pure-request 开箱即用的浏览器端request请求，基于Promise实现，支持get，post请求，不支持IE9以下浏览器
 * Date: 2022/12
 */

//TODO
/*
1.createSuccessData中blob数据中state值未非0的处理
2.上传文件，下载文件
3.设置响应类型，比如responseType: blob;
4.返回类型解析
5.多实列
6.onRequest，onResponse改成发布订阅模式
7.对createSuccessData，createErrorData返回的数据进行过滤优化
8.getData，setData中的data改成私有变量
9.区分错误类型，如网络超时错误和网络其他错误
10.接口返回的字段自定义，以及固定字段格式
11.返回状态以及回调
12.提供一个函数参数，用来生成下载文件的文件名
*/

const isURL = (url) => {
	const urlReg = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
	return urlReg.test(url);
};

const isFunction = (fn) => {
	return 'function' === typeof fn;
};

const jsonParse = (val) => {
	let result = val;
	try {
		result = JSON.parse(result);
	} catch (e) {
	}
	return result;
};

const pure = {
	//默认请求参数
	defaultConfig: {
		enableGetUrlCache: false,     //get请求的url是否开启缓存，不开启时会在url上添加时间戳，Boolean类型
		enableDataCache: false,       //是否缓存请求过的数据，Boolean类型
		//请求头是否携带logId，Object或Boolean类型，为Boolean时表示是否开启请求头携带logId，为Object时表示开启请求头携带logId并将对象值作为logId的一部分
		logId: true,
		lastId: false,                //同一个请求发送多次时，记录最后一次请求id，比较这个id拿到最后一次请求的数据
		async: true,                  //是否同步，Boolean类型
		withCredentials: false,       //跨域携带cookie，Boolean类型
		timeout: 0,                   //设置超时，单位毫秒，Number类型，0不超时
		baseUrl: '',                  //url的前缀，String类型
		url: '',		                  //请求url，String类型
		method: 'get',	              //请求方法，String类型
		data: {}, 		                //请求参数，Object类型
		header: {},                   //请求头，Object类型
		success: null,                //请求成功回调，Function类型
		error: null,                  //请求失败回调，Function类型
		complete: null,               //请求成功或失败都会执行的回调，Function类型，默认值为null
		delay: 0,                     //延迟多少毫秒发送，0是不延迟
		abortName: '',                //终止请求名称，String类型
		onRequest: config => config,  //发送请求前执行的函数，参数是发送请求的config
		onResponse: data => data,     //完成响应后执行的函数，参数是返回的数据data
		/**
		 * 对get请求的数据序列化，主要处理数据中的数组以应对不同的后端语言，这里需要自己进行URL转码，Function类型
		 * @param queryObject Object类型
		 * @returns String类型
		 * 比如：() => { qs.stringify({ a: ['1', '2'] }, { arrayFormat: 'indices' })} 将返回'a[0]=b&a[1]=c'
		 */
		serializer: null,
		/**
		 * 使用对象方式设置defaultConfig，也可以直接使用pure.defaultConfig.timeout=5000单独设置属性
		 * @param config
		 */
		set: (config) => {
			pure.defaultConfig = Object.assign({}, pure.defaultConfig, config);
		}
	},
	//获得存储值
	getData: function (name, key) {
		let data = this[name] || {};
		if (typeof key === 'string' && data[key] !== undefined) {
			data = data[key];
		}
		return data;
	},
	//设置存储值
	setData: function (name, key, value) {
		if (!this[name]) {
			this[name] = {};
		}
		//如果value未null表示删除
		if (value === null) {
			delete this[name][key];
		} else {
			this[name][key] = value;
		}
	},
	contentType: {
		default: 'application/x-www-form-urlencoded; charset=utf-8',
		json: 'application/json; charset=utf-8',
		stream: 'application/octet-stream',
		multipart: 'multipart/form-data'
	},
	responseType: ['json', 'blob', 'arraybuffer', 'document', 'text'],
	//创建uuid
	createUUID: () => {
		let s = [];
		let hexDigits = '0123456789abcdef';
		for (let i = 0; i < 36; i++) {
			s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
		}
		s[14] = '4';  // bits 12-15 of the time_hi_and_version field to 0010
		s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1);  // bits 6-7 of the clock_seq_hi_and_reserved to 01
		s[8] = s[13] = s[18] = s[23] = "-";

		let uuid = s.join('');
		return uuid;
	},
	//生成查询字符串
	toQueryString: (queryObject, serializer) => {
		let queryString;
		if (isFunction(serializer)) {
			queryString = serializer(queryObject);
		} else {
			const encode = encodeURIComponent;
			queryString = Object.keys(queryObject).map(queryKey => `${encode(queryKey)}=${encode(queryObject[queryKey])}`).join('&');
		}
		return queryString;
	},
	//创建logId
	createLogId: function () {
		const {createUUID, isObject, logId} = this;
		let logData = {
			uuid: createUUID()
		};
		if (isObject(logId)) {
			logData = Object.assign({}, logId, logData);
		}
		return btoa(JSON.stringify(logData));
	},
	//获取值类型如：string, object
	getType: (val) => {
		return Object.prototype.toString.call(val).slice(8, -1).toLowerCase();
	},
	isObject: function (val) {
		return pure.getType(val) === 'object';
	},
	createSuccessData: function (xhr) {
		return new Promise((resolve, reject) => {
			let data = xhr.response;
			if ('string' === typeof data) {
				resolve(jsonParse(data));
			} else if (data instanceof Blob) {  //如果是二进制大数据blob，则根据blob类型来处理，可能是application/json或application/octet-stream
				if (data.type.indexOf('image') !== -1) {
					resolve({data: URL.createObjectURL(data)});
				} else if (this.contentType.json.indexOf(data.type) !== -1) {
					const fd = new FileReader();
					fd.onload = () => {
						resolve(jsonParse(fd.result));
					};
					fd.readAsText(data);
				} else {
					if (!/content-disposition/ig.test(xhr.getAllResponseHeaders())) return;
					//如果是二进制流且包含下载文件名的content-disposition响应头，比如Content-Disposition: attachment;filename="abc.7z"
					const attachment = xhr.getResponseHeader('content-disposition');
					let filename = attachment.match(/filename=\"(.*)\"$/);
					if (filename) {
						filename = decodeURIComponent(filename[1]);
					}
					const fd = new FileReader();
					fd.onload = () => {
						let link = document.createElement('a');
						link.download = filename;
						link.href = fd.result;
						document.body.appendChild(link);
						link.click();
						document.body.removeChild(link);
						resolve({data: fd.result});
					};
					fd.readAsDataURL(data);
				}
			}
		});
	},
	createErrorData: function (xhr) {
		return xhr.response;
	},
	//生成请求参数
	buildConfig: function (config) {
		const {
			data: defaultData,
			header: defaultHeader,
			success: defaultSuccess,
			error: defaultError,
			complete: defaultComplete,
			onRequest: defaultOnRequest,
			onResponse: defaultOnResponse,
			...restDefaultConfig
		} = this.defaultConfig;
		let {header, data, success, error, complete, onRequest, onResponse, ...restConfig} = config;
		restConfig = Object.assign({}, restDefaultConfig, restConfig);
		header = Object.assign({}, defaultHeader, header);
		data = Object.assign({}, defaultData, data);
		let onRequestCallback = (config) => {
			const defaultOnRequestConfig = isFunction(defaultOnRequest) ? defaultOnRequest(config) : {};
			const onRequestConfig = isFunction(onRequest) ? onRequest(config) : {};
			return Object.assign({}, defaultOnRequestConfig, onRequestConfig);
		};
		let onResponseCallback = (data) => {
			const defaultOnResponseData = isFunction(defaultOnResponse) ? defaultOnResponse(data) : {};
			const onResponseData = isFunction(onResponse) ? onResponse(data) : {};
			return Object.assign({}, defaultOnResponseData, onResponseData);
		};
		let successCallback = (...args) => {
			isFunction(defaultSuccess) && defaultSuccess(...args);
			isFunction(success) && success(...args);
		};
		let errorCallback = (...args) => {
			isFunction(defaultError) && defaultError(...args);
			isFunction(error) && error(...args);
		};
		let completeCallback = (...args) => {
			isFunction(defaultComplete) && defaultComplete(...args);
			isFunction(complete) && complete(...args);
		};
		let {method, url, baseUrl, enableGetUrlCache, logId, serializer} = restConfig;
		method = method.toUpperCase();
		restConfig.origin = url;
		switch (method) {
			case 'GET':
				let queryString = this.toQueryString(data, serializer).replace(/%20/g, '+'); //url中编码后的空格替换为+
				let queryStringArr = queryString ? [queryString] : [];
				//不缓存get请求时需带时间戳
				if (!enableGetUrlCache) {
					queryStringArr.push(`_=${+new Date()}`);
				}
				const concatString = /\?/.test(url) ? '&' : '?';  //url中包含了查询字符串则使用&连接，否则使用?连接
				url = `${url}${queryStringArr.length ? concatString : ''}${queryStringArr.join('&')}`;
				data = null;
				delete header['Content-Type'];
				break;
			default:
				//处理Content-Type的兼容写法
				const contentTypeName = Object.keys(header).find(item => item.replace('-', '').toLowerCase() === 'contenttype');
				header['Content-Type'] = contentTypeName ? header[contentTypeName] : this.contentType.json;
				'Content-Type' !== contentTypeName && delete header[contentTypeName];
				break;
		}
		//请求头添加logId
		if (!!logId) {
			header.logid = this.createLogId();
		}
		//url添加前缀
		if (baseUrl && !isURL(url)) {
			url = `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
		}
		return {
			header,
			data,
			success: successCallback,
			error: errorCallback,
			complete: completeCallback,
			onRequest: onRequestCallback,
			onResponse: onResponseCallback,
			...restConfig,
			method,
			url,
		};
	},
	/**
	 * 用url和data生成一个键名
	 * @param url 地址
	 * @param data 数据
	 */
	createUrlKey: function (url, data) {
		let urls = [url.replace(/\//g, '__')];
		if (data) {
			urls.push(this.toQueryString(data));
		}
		return urls.join('_');
	},
	successHandle: async function ({resolve, urlKey, xhr}) {
		let {success, complete, onResponse, lastId, enableDataCache} = this.config;
		let res = (await this.createSuccessData(xhr)) || '';
		res = onResponse(res);
		if (lastId) {
			res.lastId = lastId;
		}
		success(res);
		complete(res);
		resolve(res);
		//配置缓存
		if (enableDataCache) {
			this.setData('cachedData', urlKey, {data: res, key: urlKey});
		}
	},
	errorHandle: function ({reject, promise, xhr}) {
		let {complete, error, onResponse, lastId} = this.config;
		let res = this.createErrorData(xhr) || '';
		res = onResponse(res);
		if (lastId) {
			res.lastId = lastId;
		}
		error(res);
		complete(res);
		//解决promise实例没有写catch报错Uncaught (in promise)
		if (promise.__proto__.catch.length > 1) {
			reject(res);
		}
	},
	//创建xhr
	createXhr: () => new XMLHttpRequest(),
	/**
	 * 发送请求，返promise实例，参数success或error在请求成功或失败时执行；或用链式then和catch在请求成功或失败时执行
	 * @param config 值参考defaultConfig
	 * @returns Promise
	 */
	request: function (config) {
		let xhr;
		this.config = this.buildConfig(config);
		const urlKey = this.createUrlKey(config.url, config.data);
		//开启了缓存就取缓存值
		if (this.config.enableDataCache) {
			const cacheData = this.getData('cachedData', urlKey);
			if (Object.keys(cacheData).length) {
				return new Promise(resolve => resolve(cacheData));
			}
		}
		const promise = new Promise((resolve, reject) => {
			xhr = this.createXhr();
			this.config = this.config.onRequest(this.config);
			let {method, data, url, header, withCredentials, async, timeout, delay, abortName, responseType} = this.config;
			xhr.open(method, url, async);
			xhr.onreadystatechange = () => {
				//通过abortName查询出来的值不是函数，表示已经调用过abort方法，并删除abort记录
				if (!!abortName && typeof this.getData('abortData', abortName) !== 'function') {
					this.setData('abortData', abortName, null);
					return;
				}
				if (xhr.readyState === 4) {
					if (xhr.status >= 200 && xhr.status < 300) {
						this.successHandle({resolve, urlKey, xhr});
					} else {
						this.errorHandle({reject, promise, xhr});
					}
				}
			};

			const headerKeys = Object.keys(header);
			if (headerKeys.length) {
				headerKeys.forEach(headerName => {
					xhr.setRequestHeader(headerName, header[headerName]);
				});
			}
			//跨域携带cookie
			if (withCredentials) {
				xhr.withCredentials = true;
			}
			//超时
			if (typeof timeout === 'number' && timeout > 0) {
				xhr.timeout = timeout;
			}
			//响应类型，blob
			if (responseType) {
				xhr.responseType = responseType;
			}
			//保存reject方法用来终止连接
			if (abortName) {
				this.setData('abortData', abortName, reject);
			}
			const sendData = () => xhr.send('string' === typeof data ? data : JSON.stringify(data));
			if (delay) {
				setTimeout(() => sendData(), delay);
			} else {
				sendData();
			}
		});

		const {abortName} = this.config;
		//保存promise实例
		if (abortName) {
			this.setData('instanceData', abortName, promise);
			this.setData('xhrData', abortName, xhr);
		}
		return promise;
	},
	/**
	 * 终止请求
	 * @param abortName
	 */
	abort: function (abortName) {
		const xhr = this.getData('xhrData', abortName);
		if (!Object.keys(xhr).length) return;
		this.errorHandle({
			promise: this.getData('instanceData', abortName),
			reject: () => this.getData('abortData', abortName),
			xhr,
		});
		//设置abortName未空，表示终止了请求
		this.setData('abortData', abortName, '');
	},
	commonRequest: function (method, url, data, restConfig) {
		let config = {method, url, data};
		if (this.isObject(restConfig)) {
			config = {
				...config,
				...restConfig
			};
		}
		return this.request(config);
	},
	get: function (url, data, restConfig) {
		return pure.commonRequest('get', url, data, restConfig);
	},
	post: function (url, data, restConfig) {
		return pure.commonRequest('post', url, data, restConfig);
	}
};

export default pure;