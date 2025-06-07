import React, { useState, useEffect, useCallback } from 'react';
import { jwtDecode } from 'jwt-decode';
import LayoutObject from "./components/pages/layoutObject.jsx";
import AuthPage from './components/pages/authPage';
import UserProfilePage from './components/pages/userProfilePage.jsx';
import AlertModal from './components/modals/alertModal.jsx';
import AddProjectModal from './components/modals/addProjectModal.jsx';
import { useStore } from './store';
import { setupGlobalAuthFailureHandler, authenticatedFetch } from './backend/services/apiService.js';
import ConfirmModal from './components/modals/confirmModal.jsx';

function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('authToken'));
	const [isLoadingData, setIsLoadingData] = useState(true);
	const [isAddProjectModalOpenFromEmptyState, setIsAddProjectModalOpenFromEmptyState] = useState(false);

	const {
		tokenExpiredAlert, showTokenExpiredAlert, clearTokenExpiredAlert,
		registrationAlert, clearRegistrationAlert,
		projects, setProjects, currentProjectId, setCurrentProjectId,
		setBoards, setTasks, dataRefreshTrigger,
		appView, setAppView,
		setCurrentUserProfile, clearCurrentUserProfile,
		setAllUsers,
		logoutConfirmModal, hideLogoutConfirmModal,
		setMainLogoutHandler,
	} = useStore(state => ({
		tokenExpiredAlert: state.tokenExpiredAlert,
		showTokenExpiredAlert: state.showTokenExpiredAlert,
		clearTokenExpiredAlert: state.clearTokenExpiredAlert,
		registrationAlert: state.registrationAlert,
		clearRegistrationAlert: state.clearRegistrationAlert,
		projects: state.projects,
		setProjects: state.setProjects,
		currentProjectId: state.currentProjectId,
		setCurrentProjectId: state.setCurrentProjectId,
		setBoards: state.setBoards,
		setTasks: state.setTasks,
		dataRefreshTrigger: state.dataRefreshTrigger,
		appView: state.appView,
		setAppView: state.setAppView,
		setCurrentUserProfile: state.setCurrentUserProfile,
		clearCurrentUserProfile: state.clearCurrentUserProfile,
		setAllUsers: state.setAllUsers,
		logoutConfirmModal: state.logoutConfirmModal,
		hideLogoutConfirmModal: state.hideLogoutConfirmModal,
		setMainLogoutHandler: state.setMainLogoutHandler,
	}));

	const handleLogout = useCallback(() => {
		localStorage.removeItem('authToken');
		setIsAuthenticated(false);
		setProjects([]);
		setBoards([]);
		setTasks([]);
		setCurrentProjectId(null);
		clearCurrentUserProfile();
		setAllUsers([]);
		setAppView('kanban');
		hideLogoutConfirmModal();
		console.log("App.jsx: Пользователь вышел, все данные очищены, вид сброшен.");
	}, [setProjects, setBoards, setTasks, setCurrentProjectId, clearCurrentUserProfile, setAppView, hideLogoutConfirmModal, setAllUsers]);

	useEffect(() => {
		setMainLogoutHandler(handleLogout);
	}, [handleLogout, setMainLogoutHandler]);

	const forceLogoutAndShowAlert = useCallback((message) => {
		handleLogout();
		showTokenExpiredAlert(message);
	}, [handleLogout, showTokenExpiredAlert]);

	useEffect(() => {
		setupGlobalAuthFailureHandler(forceLogoutAndShowAlert);
	}, [forceLogoutAndShowAlert]);

	useEffect(() => {
		const token = localStorage.getItem('authToken');
		let isActiveAttempt = true;

		if (!token) {
			setIsAuthenticated(false);
			setIsLoadingData(false);
			clearCurrentUserProfile();
			setAllUsers([]);
			setProjects([]);
			setBoards([]);
			setTasks([]);
			setCurrentProjectId(null);
			return;
		}

		setIsLoadingData(true);

		const verifyTokenAndFetchInitialData = async (currentToken) => {
			try {
				const decodedToken = jwtDecode(currentToken);
				const currentTime = Date.now() / 1000;

				if (decodedToken.exp < currentTime) {
					if (isActiveAttempt) forceLogoutAndShowAlert("Ваша сессия истекла. Пожалуйста, войдите снова.");
					return;
				}

				if (isActiveAttempt) {
					if (!isAuthenticated) setIsAuthenticated(true);
					console.log("App.jsx: Токен пользователя действителен. Загрузка начальных данных...");
				}

				const [profileResponse, projectsResponse, allUsersResponse] = await Promise.all([
					authenticatedFetch('/api/users/me'),
					authenticatedFetch('/api/projects'),
					authenticatedFetch('/api/users')
				]);

				if (isActiveAttempt) {
					try {
						if (!profileResponse.ok) {
							const errorBody = await profileResponse.text().catch(() => "Не удалось прочитать тело ответа с ошибкой для загрузки профиля.");
							console.error(`App.jsx: Не удалось загрузить профиль пользователя. Статус: ${profileResponse.status}, Тело: ${errorBody}`);
							const profileError = new Error(`Ошибка загрузки профиля: ${profileResponse.status} - ${errorBody}`);
							profileError.isProfileError = true;
							profileError.status = profileResponse.status;
							throw profileError;
						}
						const userProfile = await profileResponse.json();
						setCurrentUserProfile(userProfile);
						console.log("App.jsx: Профиль пользователя загружен с API и установлен.", userProfile);
					} catch (profileError) {
						console.error("App.jsx: Ошибка во время загрузки профиля пользователя:", profileError);
						const isAuthRelatedError = profileError.status === 401 || profileError.status === 403 || (profileError.message && (profileError.message.toLowerCase().includes('unauthorized') || profileError.message.toLowerCase().includes('session') || profileError.message.toLowerCase().includes('не авторизован')));
						if (isAuthRelatedError) {
							throw profileError;
						} else {
							console.warn("App.jsx: Используются резервные данные профиля из токена из-за ошибки API при загрузке профиля. Принудительный выход.");
							const fallbackProfile = {
								id: decodedToken.userId, email: decodedToken.email,
								firstName: decodedToken.firstName || "Пользователь", lastName: decodedToken.lastName || "",
								middleName: decodedToken.middleName || "", avatarUrl: null,
								createdAt: new Date().toISOString(),
							};
							if (isActiveAttempt) {
								setCurrentUserProfile(fallbackProfile);
								if (!tokenExpiredAlert.show) {
									forceLogoutAndShowAlert("Не удалось загрузить полный профиль пользователя. Заново авторизуйтесь в системе.");
								}
							}
							return;
						}
					}
				}

				if (isActiveAttempt) {
					if (!projectsResponse.ok) {
						const errorBody = await projectsResponse.text().catch(() => "Не удалось прочитать тело ответа с ошибкой для загрузки проектов.");
						console.error(`App.jsx: Не удалось загрузить проекты. Статус: ${projectsResponse.status}, Тело: ${errorBody}`);
						setProjects([]);
					} else {
						const fetchedProjects = await projectsResponse.json();
						setProjects(fetchedProjects);
						console.log(`App.jsx: Проекты (${fetchedProjects.length}) загружены.`);
					}
				}

				if (isActiveAttempt) {
					if (!allUsersResponse.ok) {
						const errorBody = await allUsersResponse.text().catch(() => "Не удалось прочитать тело ответа с ошибкой для загрузки списка пользователей.");
						console.error(`App.jsx: Не удалось загрузить список пользователей. Статус: ${allUsersResponse.status}, Тело: ${errorBody}`);
						setAllUsers([]);
					} else {
						const fetchedAllUsers = await allUsersResponse.json();
						setAllUsers(fetchedAllUsers);
						console.log(`App.jsx: Список всех пользователей (${fetchedAllUsers.length}) загружен.`);
					}
				}


			} catch (error) {
				console.error("App.jsx: КРИТИЧЕСКАЯ ОШИБКА во время процесса начальной загрузки данных или валидации токена:", error);
				if (isActiveAttempt) {
					const errorMessageText = error.message ? error.message.toLowerCase() : "";
					const isAuthError = errorMessageText.includes('unauthorized') || errorMessageText.includes('session') || errorMessageText.includes('не авторизован') || error.status === 401 || error.status === 403;

					if (!tokenExpiredAlert.show && !isAuthError) {
						showTokenExpiredAlert("Не удалось загрузить начальные данные приложения. Пожалуйста, попробуйте позже.");
					} else if (isAuthError && !tokenExpiredAlert.show) {
						forceLogoutAndShowAlert(errorMessageText.includes("expired") || errorMessageText.includes("истек") ? "Ваша сессия истекла. Пожалуйста, войдите снова." : "Ошибка аутентификации. Пожалуйста, войдите снова.");
					}
				}
			} finally {
				if (isActiveAttempt) setIsLoadingData(false);
			}
		};

		verifyTokenAndFetchInitialData(token);

		return () => { isActiveAttempt = false; };
	}, [isAuthenticated, dataRefreshTrigger, clearCurrentUserProfile, setProjects, setBoards, setTasks, setCurrentProjectId, showTokenExpiredAlert, forceLogoutAndShowAlert, setCurrentUserProfile, setAllUsers, tokenExpiredAlert.show, handleLogout]);

	useEffect(() => {
		let isActiveAttempt = true;
		const fetchBoardAndTaskData = async () => {
			if (isAuthenticated && currentProjectId !== null) {
				console.log(`App.jsx: currentProjectId равен ${currentProjectId}. Загрузка досок и задач.`);
				setIsLoadingData(true);
				try {
					const [boardsResponse, tasksResponse] = await Promise.all([
						authenticatedFetch('/api/boards'),
						authenticatedFetch('/api/tasks')
					]);

					if (!boardsResponse.ok) {
						const errorText = await boardsResponse.text();
						throw new Error(`Не удалось загрузить доски: ${boardsResponse.status} - ${errorText}`);
					}
					if (!tasksResponse.ok) {
						const errorText = await tasksResponse.text();
						throw new Error(`Не удалось загрузить задачи: ${tasksResponse.status} - ${errorText}`);
					}

					const fetchedBoards = await boardsResponse.json();
					const fetchedTasks = await tasksResponse.json();

					if (isActiveAttempt) {
						const currentProjectBoards = fetchedBoards.filter(b => b.projectId === currentProjectId);
						const currentProjectBoardIds = currentProjectBoards.map(b => b.id);
						const currentProjectTasks = fetchedTasks.filter(t => currentProjectBoardIds.includes(t.boardId));

						setBoards(currentProjectBoards);
						setTasks(currentProjectTasks);
						console.log(`App.jsx: Для проекта ${currentProjectId}, Доски (${currentProjectBoards.length}) и Задачи (${currentProjectTasks.length}) установлены.`);
					}
				} catch (error) {
					console.error(`App.jsx: Ошибка загрузки данных для проекта ${currentProjectId}:`, error);
					const errorMessageText = error.message ? error.message.toLowerCase() : "";
					const isAuthError = errorMessageText.includes('unauthorized') || errorMessageText.includes('session') || errorMessageText.includes('не авторизован');
					if (isActiveAttempt && !isAuthError && !tokenExpiredAlert.show) {
						showTokenExpiredAlert("Не удалось загрузить детали проекта. Пожалуйста, попробуйте еще раз.");
					}
					if(isActiveAttempt && !isAuthError) {
						setBoards([]);
						setTasks([]);
					}
				} finally {
					if (isActiveAttempt) setIsLoadingData(false);
				}
			} else if (!isAuthenticated && currentProjectId === null) {
				setBoards([]);
				setTasks([]);
			}
		};

		if (isAuthenticated && currentProjectId !== null) {
			fetchBoardAndTaskData();
		} else if (!isAuthenticated) {
			setBoards([]);
			setTasks([]);
		}
		return () => { isActiveAttempt = false; setIsLoadingData(false); };
	}, [isAuthenticated, currentProjectId, dataRefreshTrigger, tokenExpiredAlert.show, setBoards, setTasks, showTokenExpiredAlert]);


	const handleLoginSuccess = (token) => {
		if (token) {
			localStorage.setItem('authToken', token);
			setIsAuthenticated(true);
			setAppView('kanban');
			console.log("App.jsx: Вход успешен, токен сохранен. Главный useEffect перезапустит загрузку данных.");
		} else {
			console.error("App.jsx: handleLoginSuccess вызван без токена.");
		}
	};

	if (isLoadingData && localStorage.getItem('authToken')) {
		return <div className="app-container bg-secBlack h-screen w-screen flex items-center justify-center text-white text-xl">Загрузка данных...</div>;
	}

	let content;
	if (isAuthenticated) {
		if (appView === 'profile') {
			content = <UserProfilePage />;
		} else if (appView === 'kanban' || appView === 'taskView') {
			if (currentProjectId !== null && projects.length > 0) {
				content = <LayoutObject onLogout={handleLogout} />;
			} else if (appView === 'kanban' && (currentProjectId === null || projects.length === 0)) {
				content = (
					<div className="app-container bg-secBlack h-screen w-screen flex flex-col items-center justify-center text-white">
						<p className="text-xl mb-4">Добро пожаловать! У вас пока нет проектов или ни один не выбран.</p>
						<p className="mb-6">Пожалуйста, создайте проект, чтобы начать.</p>
						<button
							onClick={() => setIsAddProjectModalOpenFromEmptyState(true)}
							className="px-4 py-2 bg-sky-600 hover:bg-sky-700 rounded text-white font-semibold"
						>
							Создать свой первый проект
						</button>
						<button onClick={handleLogout} className="mt-4 text-sky-400 hover:text-sky-300">Выйти</button>
					</div>
				);
			} else {
				content = <LayoutObject onLogout={handleLogout} />;
			}
		} else {
			console.warn(`App.jsx: Неизвестный appView "${appView}", переключение на 'kanban'.`);
			setAppView('kanban');
			content = <LayoutObject onLogout={handleLogout} />;
		}
	} else {
		content = <AuthPage onLoginSuccess={handleLoginSuccess} />;
	}

	return (
		<div className="app-container bg-secBlack h-screen w-screen overflow-hidden">
			{content}
			<AddProjectModal
				isOpen={isAddProjectModalOpenFromEmptyState}
				onClose={() => setIsAddProjectModalOpenFromEmptyState(false)}
			>
				<h2 className="text-xl font-semibold text-slate-100 mb-4">Создать свой первый проект</h2>
			</AddProjectModal>
			<AlertModal isOpen={registrationAlert.show} onClose={clearRegistrationAlert} title={registrationAlert.title} message={registrationAlert.message} />
			<AlertModal isOpen={tokenExpiredAlert.show} onClose={clearTokenExpiredAlert} title="Оповещение сессии" message={tokenExpiredAlert.message} />
			<ConfirmModal
				isOpen={logoutConfirmModal.isOpen}
				onClose={hideLogoutConfirmModal}
				onConfirm={handleLogout}
				title="Подтвердите выход"
				message="Вы уверены, что хотите выйти?"
				confirmButtonText="Выйти"
				cancelButtonText="Отмена"
			/>
		</div>
	);
}

export default App;